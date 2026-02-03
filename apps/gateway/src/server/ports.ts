import net from "node:net";

/**
 * Check if a port is free by attempting a TCP connection
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(200);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(true);
    });
    socket.connect(port, "127.0.0.1");
  });
}

/**
 * Find a free port starting from basePort, scanning up to maxAttempts ports
 */
export async function findFreePort(basePort: number, maxAttempts: number = 50): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = basePort + offset;
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(`No free port found in range ${basePort}-${basePort + maxAttempts - 1}`);
}
