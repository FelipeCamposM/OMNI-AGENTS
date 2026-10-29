// Service worker do OMNI no celular: só mostra avisos e, no toque, traz a página de volta na
// conversa. Não guarda nada em cache — a página sempre vem do PC.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const url = (evento.notification.data && evento.notification.data.url) || "/";
  evento.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
    const aberta = janelas[0];
    if (!aberta) return self.clients.openWindow(url);
    return aberta.focus().then((janela) => (janela.navigate ? janela.navigate(url) : janela));
  }));
});
