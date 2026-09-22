// app.js coordinator
import { AppState } from './modules/config.js';
import { mostrarPantallaLogin } from './modules/auth.js';
import { renderVistaAnimales } from './modules/views/cattle_view.js';
import { setupAsistenteIA } from './modules/views/assistant_view.js';

async function iniciarAplicacion() {
  console.log("App iniciada con módulos ES");
}

document.addEventListener("DOMContentLoaded", async () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }
  await iniciarAplicacion();
});
