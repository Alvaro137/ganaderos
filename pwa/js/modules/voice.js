// modules/voice.js
/**
 * Módulo de captura de voz y transcripción (Web Speech API + Groq Whisper fallback).
 */

import { fetchTranscribe } from './api.js';

export class VoiceManager {
  constructor({ onResult, onStatus, onStateChange, onWaveform }) {
    this.onResult = onResult || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.onWaveform = onWaveform || (() => {});

    this.escuchandoVoz = false;
    this.grabacionPorMediaRecorder = false;
    this.speechRecognition = null;
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.audioChunks = [];

    this._initWebSpeech();
  }

  _initWebSpeech() {
    if (typeof window === "undefined") return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        this.speechRecognition = new SpeechRec();
        this.speechRecognition.lang = "es-ES";
        this.speechRecognition.continuous = false;
        this.speechRecognition.interimResults = false;

        this.speechRecognition.onstart = () => {
          this.escuchandoVoz = true;
          this.grabacionPorMediaRecorder = false;
          this.onStateChange(true);
          this.onWaveform(true);
          this.onStatus("Escuchando... habla a tu teléfono o micrófono");
        };

        this.speechRecognition.onresult = (event) => {
          if (event.results && event.results[0] && event.results[0][0]) {
            const transcript = event.results[0][0].transcript.trim();
            this.onStatus(`"${transcript}"`);
            this.detener();
            this.onResult(transcript);
          }
        };

        this.speechRecognition.onerror = (event) => {
          console.warn("Error en reconocimiento de voz nativo:", event.error);
          this.detener();
          if (event.error === "no-speech") {
            this.onStatus("No se ha escuchado nada. Toca para volver a hablar.");
          } else if (event.error === "not-allowed") {
            this.onStatus("Permiso de micrófono denegado. Puedes escribir tu consulta abajo.");
          } else {
            this.onStatus("Error al captar audio. Vuelve a probar o escribe abajo.");
          }
        };

        this.speechRecognition.onend = () => {
          if (this.escuchandoVoz && !this.grabacionPorMediaRecorder) {
            this.detener();
          }
        };
      } catch (err) {
        console.warn("No se pudo inicializar Web Speech API:", err);
      }
    }
  }

  iniciar() {
    if (this.speechRecognition) {
      try {
        this.speechRecognition.start();
        return;
      } catch (e) {
        console.warn("Fallo al iniciar Web Speech API, usando fallback MediaRecorder:", e);
      }
    }
    this._iniciarMediaRecorder();
  }

  async _iniciarMediaRecorder() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.onStatus("Tu navegador no permite grabar audio. Escribe tu consulta abajo.");
      return;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];

      let mimeType = "";
      if (typeof MediaRecorder.isTypeSupported === "function") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
          mimeType = "audio/ogg;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        }
      }

      this.mediaRecorder = mimeType ? new MediaRecorder(this.mediaStream, { mimeType }) : new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach((t) => t.stop());
          this.mediaStream = null;
        }

        if (this.audioChunks.length === 0) {
          this.onStatus("No se grabó audio. Toca para reintentar.");
          return;
        }

        const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || "audio/webm" });
        this.onStatus("Transcribiendo voz con IA (Whisper)...");
        this.onWaveform(false);

        try {
          const resp = await fetchTranscribe(audioBlob);

          const data = await resp.json();
          if (resp.ok && data.ok && data.text) {
            const textoTranscrito = data.text.trim();
            this.onStatus(`"${textoTranscrito}"`);
            this.onResult(textoTranscrito);
          } else {
            const err = data.error || "No se pudo transcribir el audio.";
            this.onStatus(err);
          }
        } catch (e) {
          console.error("Error enviando audio a transcripción:", e);
          this.onStatus("Error al conectar con el servidor de transcripción.");
        }
      };

      this.mediaRecorder.start();
      this.escuchandoVoz = true;
      this.grabacionPorMediaRecorder = true;
      this.onStateChange(true);
      this.onWaveform(true);
      this.onStatus("Grabando... Toca el micro otra vez para enviar la consulta");
    } catch (err) {
      console.warn("Error obteniendo micrófono con getUserMedia:", err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        this.onStatus("Permiso de micrófono denegado. Habilítalo en los permisos del navegador.");
      } else {
        this.onStatus("No se pudo acceder al micrófono. Puedes escribir abajo.");
      }
      this.detener();
    }
  }

  detener() {
    this.escuchandoVoz = false;
    this.onStateChange(false);

    if (this.grabacionPorMediaRecorder && this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.grabacionPorMediaRecorder = false;
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.warn("Error deteniendo MediaRecorder:", e);
      }
      return;
    }

    this.onWaveform(false);
    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch (_) {}
    }
  }
}
