import { type ApiError, MAX_UPLOAD_BYTES, mealPaths, planningRequestPaths } from "@yamt/shared";
import { type OutboxTransport, type PendingCapture, TransportError } from "./types";

/** The queue's HTTP side: JSON with fetch, uploads with XHR (fetch can't report upload progress). */
export const httpTransport: OutboxTransport = {
  async ensureMeal(mealId) {
    await json("POST", mealPaths.meals, { id: mealId });
  },

  async sendCapture(e, onProgress) {
    const c = e.capture;
    if (c.kind === "text") {
      await json("POST", mealPaths.captures(e.mealId), {
        id: e.id,
        kind: "text",
        text: c.text,
        capturedAt: e.capturedAt,
      });
    } else if (c.kind === "link") {
      await json("POST", mealPaths.captures(e.mealId), {
        id: e.id,
        kind: "link",
        url: c.url,
        ...(c.text ? { text: c.text } : {}),
        capturedAt: e.capturedAt,
      });
    } else if ("blob" in c) {
      await upload(mealPaths.captures(e.mealId), e.id, e.capturedAt, c, onProgress);
    } else {
      await json("POST", mealPaths.captures(e.mealId), {
        id: e.id,
        kind: c.kind,
        text: c.text,
        ...(c.kind === "answer" && c.questionId ? { questionId: c.questionId } : {}),
        capturedAt: e.capturedAt,
      });
    }
  },

  async analyse(mealId) {
    await json("POST", mealPaths.analyse(mealId), {});
  },

  async createPlanningRequest(e) {
    await json("POST", planningRequestPaths.requests, {
      id: e.requestId,
      filters: e.filters,
      tz: e.tz,
      ...(e.text ? { text: e.text } : {}),
    });
  },

  async sendPlanningInput(e, onProgress) {
    const c = e.input;
    const path = planningRequestPaths.inputs(e.requestId);
    if (c.kind === "text") {
      await json("POST", path, { id: e.id, kind: "text", text: c.text, capturedAt: e.capturedAt });
    } else if (c.kind === "link") {
      await json("POST", path, {
        id: e.id,
        kind: "link",
        url: c.url,
        ...(c.text ? { text: c.text } : {}),
        capturedAt: e.capturedAt,
      });
    } else {
      await upload(path, e.id, e.capturedAt, c, onProgress);
    }
  },

  async startRound(e) {
    const path = e.kind === "more" ? planningRequestPaths.more : planningRequestPaths.suggest;
    await json("POST", path(e.requestId), { id: e.id });
  },
};

async function json(method: string, path: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TransportError("No connection to yamt");
  }
  const text = await res.text();
  if (!res.ok) throw new TransportError(errorMessage(res.status, text), res.status);
  return text ? JSON.parse(text) : null;
}

/** A file (a meal capture or a planning input) as multipart, with progress. */
function upload(
  path: string,
  id: string,
  capturedAt: number,
  c: Extract<PendingCapture, { blob: Blob }>,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const form = new FormData();
  form.set("id", id);
  form.set("kind", c.kind);
  form.set("capturedAt", String(capturedAt));
  if (c.questionId) form.set("questionId", c.questionId);
  form.set("file", c.blob, c.fileName);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new TransportError(errorMessage(xhr.status, xhr.responseText), xhr.status));
    };
    xhr.onerror = () => reject(new TransportError("No connection to yamt"));
    xhr.ontimeout = () => reject(new TransportError("The upload timed out"));
    xhr.onabort = () => reject(new TransportError("The upload was interrupted"));
    xhr.send(form);
  });
}

function errorMessage(status: number, body: string): string {
  // Bun answers an oversized body with an empty 413 before our code sees it
  if (status === 413) return `Larger than the server accepts (${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`;
  try {
    const err = JSON.parse(body) as ApiError;
    if (err.error) return err.hint ? `${err.error} (${err.hint})` : err.error;
  } catch {
    // not JSON
  }
  return `The server answered ${status}`;
}
