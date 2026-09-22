// modules/api.js
import { obtenerAuthHeaders } from './auth.js';

export async function fetchIntent(prompt, history) {
  const resp = await fetch("./api/ai/intent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...obtenerAuthHeaders()
    },
    body: JSON.stringify({ prompt, historial: history })
  });
  return resp;
}

export async function fetchModels() {
  const resp = await fetch("./api/ai/models", {
    headers: obtenerAuthHeaders()
  });
  return resp;
}

export async function fetchSynthesize(prompt, data, columns, history, modelId) {
  const resp = await fetch("./api/ai/synthesize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...obtenerAuthHeaders()
    },
    body: JSON.stringify({ prompt, data, columns, history, model_id: modelId })
  });
  return resp;
}

export async function fetchTranscribe(audioBlob) {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
  const authHeaders = obtenerAuthHeaders();
  delete authHeaders["Content-Type"];
  const resp = await fetch("./api/ai/transcribe", {
    method: "POST",
    headers: authHeaders,
    body: formData,
  });
  return resp;
}

export async function fetchDatabase() {
  const resp = await fetch("./api/database", {
    headers: obtenerAuthHeaders()
  });
  return resp;
}
