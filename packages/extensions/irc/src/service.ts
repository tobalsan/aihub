import net from "node:net";
import tls from "node:tls";
import { parseIrcLine, type IrcMessage } from "./protocol.js";

export type IrcServiceConfig = { host: string; port: number; tls: boolean; nick: string; username?: string; password?: string; nickservPassword?: string; channels: string[] };
export class IrcService {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private buffer = "";
  private queued: string[] = [];
  private currentNick: string;
  constructor(private config: IrcServiceConfig, private onMessage: (message: IrcMessage) => void, private log: Pick<Console, "info" | "warn" | "error"> = console) { this.currentNick = config.nick; }
  start(): void { this.stopped = false; this.connect(); }
  stop(): void { this.stopped = true; if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null; this.socket?.destroy(); this.socket = null; }
  send(target: string, text: string): void { this.write(`PRIVMSG ${target} :${text}`); }
  get nick(): string { return this.currentNick; }
  private connect(): void {
    const onConnect = () => { this.log.info(`[irc] connected ${this.config.host}:${this.config.port}`); if (this.config.password) this.write(`PASS ${this.config.password}`); this.write(`NICK ${this.config.nick}`); this.write(`USER ${this.config.username ?? this.config.nick} 0 * :${this.config.nick}`); };
    const socket = this.config.tls ? tls.connect({ host: this.config.host, port: this.config.port, servername: this.config.host }, onConnect) : net.connect({ host: this.config.host, port: this.config.port }, onConnect);
    this.socket = socket;
    socket.setEncoding("utf8"); socket.setKeepAlive(true, 30_000);
    socket.on("data", (data: string) => this.receive(data));
    socket.on("error", (error) => this.log.warn(`[irc] socket error: ${error.message}`));
    socket.on("close", () => { this.socket = null; if (!this.stopped) { this.log.warn("[irc] disconnected; reconnecting"); this.reconnectTimer = setTimeout(() => this.connect(), 5_000); } });
  }
  private receive(data: string): void { this.buffer += data; const lines = this.buffer.split("\n"); this.buffer = lines.pop() ?? ""; for (const line of lines) { const message = parseIrcLine(line); if (!message) continue; if (message.command === "PING") this.write(`PONG :${message.trailing ?? message.params[0] ?? ""}`); if (message.command === "001") { if (this.config.nickservPassword) this.write(`PRIVMSG NickServ :IDENTIFY ${this.config.nickservPassword}`); for (const channel of this.config.channels) this.write(`JOIN ${channel}`); const queued = this.queued.splice(0); queued.forEach((entry) => this.write(entry)); } if (message.command === "433") { this.currentNick = `${this.currentNick}_`; this.write(`NICK ${this.currentNick}`); } this.onMessage(message); } }
  private write(line: string): void { const clean = line.replace(/[\r\n]/g, " "); if (this.socket?.writable) this.socket.write(`${clean}\r\n`); else this.queued.push(clean); }
}
