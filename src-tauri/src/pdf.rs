//! "Baixar PDF" do Markdown em modo documento: o próprio WebView2 imprime a página em PDF (texto
//! selecionável, vetorial). O CSS de impressão (`documentoPaginado.css`) deixa só as folhas A4 visíveis.

#[cfg(windows)]
#[tauri::command]
pub async fn salvar_pdf_da_pagina(webview: tauri::Webview, caminho: String) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7};
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING};

    if !caminho.to_lowercase().ends_with(".pdf") { return Err("O arquivo precisa terminar em .pdf".into()); }
    let (enviar, receber) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let enviar = std::sync::Mutex::new(Some(enviar));
    webview.with_webview(move |w| unsafe {
        let responder = move |r: Result<(), String>| { if let Some(e) = enviar.lock().ok().and_then(|mut e| e.take()) { let _ = e.send(r); } };
        let preparar = || -> windows_core::Result<(ICoreWebView2_7, webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PrintSettings)> {
            let core = w.controller().CoreWebView2()?.cast::<ICoreWebView2_7>()?;
            let ajustes = w.environment().cast::<ICoreWebView2Environment6>()?.CreatePrintSettings()?;
            // A4 em polegadas, sem margem (a folha já tem a dela), com fundo e sem cabeçalho/rodapé do navegador.
            ajustes.SetPageWidth(8.27)?;
            ajustes.SetPageHeight(11.69)?;
            ajustes.SetMarginTop(0.0)?;
            ajustes.SetMarginBottom(0.0)?;
            ajustes.SetMarginLeft(0.0)?;
            ajustes.SetMarginRight(0.0)?;
            ajustes.SetShouldPrintBackgrounds(true.into())?;
            ajustes.SetShouldPrintHeaderAndFooter(false.into())?;
            Ok((core, ajustes))
        };
        match preparar() {
            Err(e) => responder(Err(e.message())),
            Ok((core, ajustes)) => {
                let responder = std::sync::Arc::new(std::sync::Mutex::new(Some(responder)));
                let no_fim = responder.clone();
                let handler = PrintToPdfCompletedHandler::create(Box::new(move |resultado, ok| {
                    let r = match resultado { Err(e) => Err(e.message()), Ok(()) if ok => Ok(()), Ok(()) => Err("O WebView não conseguiu gerar o PDF.".into()) };
                    if let Some(f) = no_fim.lock().ok().and_then(|mut f| f.take()) { f(r); }
                    Ok(())
                }));
                if let Err(e) = core.PrintToPdf(&HSTRING::from(caminho.as_str()), &ajustes, &handler) {
                    if let Some(f) = responder.lock().ok().and_then(|mut f| f.take()) { f(Err(e.message())); }
                }
            }
        }
    }).map_err(|e| e.to_string())?;
    receber.await.map_err(|_| "O WebView fechou antes de terminar o PDF.".to_string())?
}

/// Fora do Windows a interface usa `window.print()` (o diálogo do sistema tem "Salvar como PDF").
#[cfg(not(windows))]
#[tauri::command]
pub async fn salvar_pdf_da_pagina(_caminho: String) -> Result<(), String> {
    Err("Use Imprimir → Salvar como PDF neste sistema.".into())
}
