/**
 * Created by alykoshin on 02/05/23.
 */

// const ipaddr = require('ipaddr.js')
import ipaddr from 'ipaddr.js';
import {Buffer} from 'node:buffer';
import net from 'node:net';


interface P0fResult {
  magic: number;
  status: number;
  first_seen: number;
  last_seen: number;
  total_conn: number;
  uptime_min: number;
  up_mod_days: number;
  last_nat: number;
  last_chg: number;
  distance: number;
  bad_sw: number;
  os_match_q: number;
  os_name: string;
  os_flavor: string;
  http_name: string;
  http_flavor: string;
  link_mtu?: number;
  link_type: string;
  language: string;
}

type T = keyof P0fResult;


function unixToDate(t: number): Date {
  return new Date(t * 1000);
}

const statusToStr = (status: number): string => status === 0
  ? 'bad query'
  : status === 0x10
    ? 'OK'
    : status === 0x20
      ? 'no match'
      : 'unknown'


interface ClientOptions {
  socketPath: string;
  socketTimeout: number;
}

const defaultOptions: Partial<ClientOptions> = {
  socketPath: '/var/run/p0f.sock',
  socketTimeout: 1000,
  // const SOCK = "/var/run/p0f.sock";
  // SOCK = "/var/run/docker_internal/p0f.sock";
}


class Reader {
  // buffer: Buffer

  constructor(private buffer: Buffer, public p: number = 0) {
  }

  u32() {
    const res = this.buffer.readUInt32LE(this.p);
    this.p += 4;
    return res;
  }

  u16() {
    const res = this.buffer.readUInt16LE(this.p);
    this.p += 2;
    return res;
  }

  s16() {
    const res = this.buffer.readInt16LE(this.p);
    this.p += 2;
    return res;
  }

  u8() {
    const res = this.buffer.readUInt8(this.p);
    this.p += 1;
    return res;
  }

  str(len: number): string {
    const res = this.buffer.toString('latin1', this.p, len);
    this.p += len;
    return res;
  }

}


class Writer {

  constructor(private buffer: Buffer, public p: number = 0) {

  }

  u32be(value: number): void {
    this.buffer.writeUInt32BE(value, this.p);
    this.p++;
  }

  u32le(value: number): void {
    this.buffer.writeUInt32LE(value, this.p);
    this.p++;
  }

  u8(value: number): void {
    this.buffer.writeUInt8(value, this.p);
    this.p++;
  }

  u8a(values: number[], limit?: number): void {
    for (const value of values) {
      this.u8(value);
    }
    if (typeof limit !== 'undefined') {
      this.p += limit - values.length;
    }
  }

}


interface AwaiterOptions {
  timeout: number;
}

class Awaiter<T> {

  promise: Promise<T>;
  timer: NodeJS.Timeout;
  timeout: number

  constructor(options: AwaiterOptions) {
    this.timeout = options.timeout;

    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });

    this.timer = setTimeout(
      () => this.reject(new Error(`Timed out waiting for the response from p0f (${this.timeout}ms)`)),
      this.timeout
    );

  }

  resolve: (result: T) => void = () => undefined;    // just to avoid TS complains

  reject: (error: Error) => void = () => undefined;  // just to avoid TS complains

}


export class P0fClient {
  options: ClientOptions;

  socket?: net.Socket;
  waitResponse?: Awaiter<P0fResult>;

  constructor(options: ClientOptions) {
    this.options = {...defaultOptions, ...options};
  }

  close() {
    this.socket && (
      this.socket.end(),
        this.socket.unref()
    )
  }

  async query(ip: string): Promise<P0fResult> {
    await this.open();
    const bytes = ipaddr.parse(ip).toByteArray();
    await this.send(bytes);
    this.waitResponse = new Awaiter({timeout: this.options.socketTimeout});
    return this.waitResponse.promise;
  }

  async open(): Promise<P0fClient> {

    return new Promise((resolve, _reject) => {
      this.socket = net.createConnection(this.options.socketPath);

      this.socket.on("connect", () => {
        console.log('connect');
      });

      this.socket.on("ready", () => {
        console.log('ready');
        resolve(this);
      })

      this.socket.on("close", () => {
        console.log('close');
      })

      this.socket.on("error", (e) => {
        console.error('error', e);
        if (this.waitResponse) {
          this.waitResponse.reject(e);
          this.waitResponse = undefined;
        }
      })

      this.socket.on("end", () => {
        console.log('end');
      })

      this.socket.on("timeout", () => {
        console.log('timeout');
        if (this.waitResponse) {
          this.waitResponse.reject(new Error('Timeout'));
          this.waitResponse = undefined;
        }
      })

      this.socket.on("data", (data: Buffer) => {
        console.log('data', data);
        this.handleData(data)
      });

    });
  }


  handleData(data: Buffer) {
    const P0F_STR_MAX = 31

    const reader = new Reader(data);
    // const reader = (bufMethod, len) => { const res = fn(data, p, len); p += len; return res; }

    // function formatSeen_(t: number) {
    //   const ONE_SECOND = 1000 * 1000;
    //   const ONE_MINUTE = 60 * ONE_SECOND;
    //   const ONE_HOUR = 60 * ONE_MINUTE;
    //   const ONE_DAY = 24 * ONE_HOUR;
    //   const dd = Math.floor(t / ONE_DAY)
    //   const hh = Math.floor((t - dd * ONE_DAY) / ONE_HOUR)
    //   const mm = Math.floor((t - dd * ONE_DAY - hh * ONE_HOUR) / ONE_MINUTE)
    //   const ss = Math.floor((t - dd * ONE_DAY - hh * ONE_HOUR - mm * ONE_MINUTE) / ONE_SECOND)
    //   const ms = t - ss * 1000;
    //   return `${dd} days, ${hh}:${mm}:${ss}.${ms}`;
    // }

    // const p0f_fields_a: { name: T, reader: () => number | string }[] = [
    //   {name: 'magic', reader: u32},
    //   {name: 'magic', reader: u32},
    // ]
    // const p0f_fields: { [key in T]: () => number | string } = {
    //   magic: u32,
    //   status: u32,
    //   first_seen: u32,
    //   last_seen: u32,
    //   total_conn: u32,
    //
    //   uptime_min: u32,
    //   up_mod_days: u32,
    //
    //   last_nat: u32,
    //   last_chg: u32,
    //
    //   distance: s16,
    //
    //   bad_sw: u8,
    //   os_match_q: u8,
    //
    //   os_name: str32,
    //   os_flavor: str32,
    //
    //   http_name: str32,
    //   http_flavor: str32,
    //
    //   link_type: str32,
    //   language: str32,
    // }

    // const r: P0fResult = {
    const magic = reader.u32();
    if (magic !== 0x50304602) {
      console.warn('Received unexpected magic:', magic);
    }

    const status = reader.u32();
    if (status !== 0x10) {
      console.warn('Received invalid status:', statusToStr(status), status);
    }

    const first_seen = reader.u32();
    const last_seen = reader.u32();
    const total_conn = reader.u32();

    const uptime_min = reader.u32();
    const up_mod_days = reader.u32();

    const last_nat = reader.u32();
    const last_chg = reader.u32();

    const distance = reader.s16();

    const bad_sw = reader.u8();
    const os_match_q = reader.u8();

    const os_name = reader.str(32);
    const os_flavor = reader.str(32);

    const http_name = reader.str(32);
    const http_flavor = reader.str(32);

    if (data.length !== 232 && data.length !== 234) {
      console.warn('Unexpected data.length:', data.length);
    }
    const VER_MTU = data.length === 234;
    const link_mtu = VER_MTU ? reader.u16() : undefined;

    const link_type = reader.str(32);
    const language = reader.str(32);

    const r = {
      magic,
      status,

      first_seen,
      last_seen,
      total_conn,

      uptime_min,
      up_mod_days,

      last_nat,
      last_chg,

      distance,

      bad_sw,
      os_match_q,

      os_name,
      os_flavor,

      http_name,
      http_flavor,

      link_mtu,

      link_type,
      language,
    };

    if (this.waitResponse) {
      this.waitResponse.resolve(r);
    }

    return r;
  }

  printResult(r: P0fResult) {

    const status_str = statusToStr(r.status);

    // console.log('p:', reader.p, 'data.length:', data.length)

    console.log('0x' + r.magic.toString(16), '0x' + r.status.toString(16), status_str)
    console.log('first_seen:', unixToDate(r.first_seen), 'last_seen:', unixToDate(r.last_seen), 'total_conn:', r.total_conn)
    console.log('uptime_min:', r.uptime_min, 'up_mod_days:', r.up_mod_days, 'last_nat:', r.last_nat, 'last_chg:', r.last_chg)
    console.log('distance:', r.distance)
    console.log('os_name:', r.os_name, 'os_flavor:', r.os_flavor)
    console.log('http_name:', r.http_name, 'http_flavor:', r.http_flavor);
    if (r.link_mtu !== undefined) {
      console.log('link_mtu:', r.link_mtu);
    }
    console.log('link_type:', r.link_type, 'language:', r.language)

  }

  // responsePromise: Promise<>

  async send(ip: number[]) {
    if (!this.socket) throw new Error('Socket is not initialized');

    const magic = 0x50304601;
    const ip_version = 4;
    const address_type_byte = 4;
    //const addr =

    const buf = Buffer.alloc(4 + 1 + 16);

    const writer = new Writer(buf);
    writer.u32le(magic);
    writer.u8(ip_version);
    writer.u8a(ip, 16);

    this.socket.write(buf)
    console.log('send', buf);

    // this.responsePromise = new Promise((resolve, reject) => {
    //
    //
    //
    // });
  }

}
