use serde::Serialize;
use std::process::Command;

use crate::git_client::hidden;

/// Uma linha do `docker ps -a --format '{{json .}}'`, só com o que o painel usa.
#[derive(Debug, Serialize, PartialEq)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    /// `running`, `exited`, `paused`, `created`, `restarting`, `dead`.
    pub state: String,
    /// Texto humano do docker: "Up 3 hours", "Exited (0) 2 days ago".
    pub status: String,
    pub ports: String,
    /// Projeto do Compose (label `com.docker.compose.project`), vazio se não veio de Compose.
    pub compose_project: String,
}

fn run_docker(args: &[&str]) -> Result<String, String> {
    let output = hidden(&mut Command::new("docker"))
        .args(args)
        .output()
        .map_err(|_| "Docker não encontrado no PATH.".to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() { format!("docker {} falhou", args.join(" ")) } else { stderr });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn label(labels: &str, key: &str) -> String {
    labels
        .split(',')
        .find_map(|pair| pair.strip_prefix(key)?.strip_prefix('='))
        .unwrap_or_default()
        .to_string()
}

fn parse_containers(stdout: &str) -> Vec<DockerContainer> {
    stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .map(|row| {
            let field = |key: &str| row.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            DockerContainer {
                id: field("ID"),
                name: field("Names"),
                image: field("Image"),
                state: field("State"),
                status: field("Status"),
                ports: field("Ports"),
                compose_project: label(&field("Labels"), "com.docker.compose.project"),
            }
        })
        .collect()
}

/// Bloqueante (o `docker` sem daemon demora a desistir): roda fora da thread da janela.
#[tauri::command]
pub async fn docker_containers() -> Result<Vec<DockerContainer>, String> {
    tauri::async_runtime::spawn_blocking(|| run_docker(&["ps", "-a", "--no-trunc", "--format", "{{json .}}"]))
        .await
        .map_err(|error| error.to_string())?
        .map(|stdout| parse_containers(&stdout))
}

#[tauri::command]
pub async fn docker_container_action(id: String, action: String) -> Result<(), String> {
    let args: Vec<&str> = match action.as_str() {
        "start" | "stop" | "restart" => vec![action.as_str(), id.as_str()],
        // `-f`: remover pelo painel é uma decisão já confirmada na UI; parar antes é detalhe.
        "remove" => vec!["rm", "-f", id.as_str()],
        _ => return Err(format!("ação desconhecida: {action}")),
    };
    let args: Vec<String> = args.into_iter().map(str::to_owned).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run_docker(&refs).map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_linha_do_docker_ps_com_projeto_do_compose() {
        let linha = r#"{"ID":"abc","Names":"web-1","Image":"nginx","State":"running","Status":"Up 2 hours","Ports":"0.0.0.0:80->80/tcp","Labels":"com.docker.compose.project=loja,com.docker.compose.service=web"}"#;
        let containers = parse_containers(&format!("{linha}\nlixo\n"));
        assert_eq!(containers.len(), 1);
        assert_eq!(containers[0].name, "web-1");
        assert_eq!(containers[0].state, "running");
        assert_eq!(containers[0].compose_project, "loja");
    }
}
