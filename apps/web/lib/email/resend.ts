import { Resend } from "resend";

const globalForResend = globalThis as unknown as {
  resend: Resend | undefined;
};

function createResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  // Initialize with API key, will error at runtime if key is missing when actually used
  return new Resend(apiKey);
}

function getResend(): Resend {
  if (globalForResend.resend) {
    return globalForResend.resend;
  }
  const client = createResendClient();
  globalForResend.resend = client;
  return client;
}

// Use lazy getter to avoid initializing during build
export const resend: Resend = new Proxy(
  {},
  {
    get: (_, prop: string | symbol) => {
      const client = getResend();
      const value = Reflect.get(client, prop);
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
) as Resend;
