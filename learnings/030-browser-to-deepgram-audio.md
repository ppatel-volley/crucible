# Browser-to-Deepgram Audio Streaming

**Severity:** Critical
**Sources:** emoji-multiplatform/006, emoji-multiplatform/007
**Category:** Audio, WebSocket, Speech-to-Text

## Principle

Browser audio capture and streaming to speech-to-text services involves multiple interconnected problems: WebSocket auth, transport conflicts, audio format detection, container encoding issues, AudioContext user gesture requirements, and microphone device selection. Always specify encoding and sample_rate explicitly — auto-detect does not work for WebSocket streams.

## Details

### 1. WebSocket authentication

Deepgram API keys must never be exposed to the client. Run a server-side WebSocket proxy that authenticates with Deepgram and relays audio from the browser.

```ts
// SERVER — proxy WebSocket to Deepgram
import WebSocket from "ws";

wss.on("connection", (clientWs) => {
  const dgWs = new WebSocket(
    "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000",
    { headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` } }
  );

  clientWs.on("message", (audio) => dgWs.send(audio));
  dgWs.on("message", (transcript) => clientWs.send(transcript));
});
```

### 2. Transport conflicts — separate WebSocket for audio

Do not reuse a Socket.IO transport (e.g. VGF/WGF) for audio streaming. Socket.IO adds framing, encoding, and event wrapping that corrupts raw audio bytes. Use a dedicated plain WebSocket for the audio stream.

### 3. Deepgram format detection

Deepgram cannot auto-detect format for WebSocket streams. You must specify `encoding` and `sample_rate` in the connection URL:

```
wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000
```

Without these, Deepgram silently produces empty or garbled transcripts.

### 4. Opus/WebM container issues

`MediaRecorder` produces WebM containers wrapping opus audio. Deepgram rejects these containers over WebSocket even though it supports opus. Use `AudioWorklet` (or the deprecated `ScriptProcessor` for prototyping) to capture raw PCM samples instead.

```ts
// AudioWorklet processor — sends raw linear16 PCM
class AudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]) {
    const input = inputs[0][0];
    if (input) {
      // Convert float32 to int16
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }
    return true;
  }
}
```

### 5. AudioContext user gesture requirement

Browsers require a user gesture (click, tap) before creating or resuming an AudioContext. Attempting to create one on page load silently suspends the context — no audio flows.

### 6. Microphone device selection

`navigator.mediaDevices.getUserMedia()` defaults to the system default mic. On TV platforms and shared devices, this is frequently wrong. Always enumerate devices and allow explicit selection.

### 7. Dev server port conflict (EADDRINUSE)

When using `tsx watch` for the dev server, restarts do not release the port (e.g. 8081) quickly enough for the Deepgram proxy. The proxy fails with `EADDRINUSE`, and the symptom is "transcription not working" with no obvious cause. This is the number one cause of transcription failures in development.

**Fix:** Use `SO_REUSEADDR` or choose a separate port for the Deepgram proxy that is not managed by the dev server watcher.

## Prevention

1. **Always specify encoding and sample_rate** in the Deepgram WebSocket URL. Never rely on auto-detection for streaming.
2. **Dedicated WebSocket** for audio — never multiplex audio over Socket.IO or other framed transports.
3. **Use AudioWorklet** for production audio capture. ScriptProcessor is deprecated and runs on the main thread.
4. **Server-side proxy** for API key security. Never send the Deepgram key to the browser.
5. **Port management** in dev: assign the audio proxy a fixed port separate from the main dev server, or use `SO_REUSEADDR`.

<details>
<summary>EM-006 — Deepgram Streaming Format</summary>

Initial implementation used `MediaRecorder` with `audio/webm;codecs=opus` and sent blobs directly to Deepgram over WebSocket. Deepgram returned empty transcripts with no error. The fix was switching to `ScriptProcessor` (later `AudioWorklet`) to capture raw linear16 PCM and specifying `encoding=linear16&sample_rate=16000` in the Deepgram URL.

</details>

<details>
<summary>EM-007 — Full Audio Pipeline Debugging</summary>

EM-007 documented the complete set of six problems encountered building the browser-to-Deepgram pipeline: (1) API key exposed in client code, (2) audio sent over Socket.IO transport corrupted by framing, (3) Deepgram format auto-detect failing silently, (4) MediaRecorder WebM containers rejected, (5) AudioContext suspended without user gesture, (6) wrong microphone selected on TV device. Each problem was discovered independently over several days, as the symptom for all six was identical: "no transcription results."

</details>

<details>
<summary>EM-011 — Dev Server Port Conflict</summary>

The `tsx watch` process restarted the dev server on file changes, but the Deepgram WebSocket proxy shared port 8081. On restart, the old process hadn't released the port, causing `EADDRINUSE`. The proxy silently failed to start, and transcription stopped working. Moving the proxy to a dedicated port (8082) with `SO_REUSEADDR` resolved the issue.

</details>
