//! Microfone sem o aviso nativo do WebView2 ("tauri.localhost quer usar seus microfones"): o app
//! libera só para as páginas dele, e quem pergunta à pessoa é o modal do Composer, uma vez.

#[cfg(windows)]
pub fn liberar<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    let _ = webview.with_webview(|w| unsafe {
        let Ok(core) = w.controller().CoreWebView2() else { return };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut tipo = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut tipo)?;
            let mut uri = windows_core::PWSTR::null();
            args.Uri(&mut uri)?;
            let do_app = tauri::Url::parse(&webview2_com::take_pwstr(uri)).is_ok_and(|url| crate::eh_do_app(&url));
            if tipo == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE && do_app {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_PermissionRequested(&handler, &mut token);
    });
}

#[cfg(not(windows))]
pub fn liberar<R: tauri::Runtime>(_: &tauri::Webview<R>) {}
