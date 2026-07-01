# HTTP/3 (QUIC) edge gateway

Optional **HTTP/3** listener for the Pertisk edge using [tokio-quiche](https://github.com/cloudflare/quiche/tree/master/tokio-quiche) (Cloudflare Quiche + Tokio).

## Architecture

```
Browser --HTTPS (TCP/TLS)--> pertisk-h3-gateway :8443 --HTTP/1.1--> pertisk-api :8080
curl    --HTTP/3 (UDP/QUIC)-> pertisk-h3-gateway :8443 --HTTP/1.1--> pertisk-api :8080
```

Port **8443** serves both protocols on the same port number:

| Protocol | Transport | Client |
|----------|-----------|--------|
| HTTPS (HTTP/1.1 or HTTP/2) | **TCP** + TLS | Web browsers (`https://localhost:8443`) |
| HTTP/3 | **UDP** + QUIC | `curl --http3-only`, HTTP/3 clients |

Browsers cannot speak QUIC directly when you type a URL — they open **TCP** first. Without the TCP listener you only get `ERR_CONNECTION_REFUSED` in Chrome/Firefox even though `curl --http3-only` works.

TCP responses include `Alt-Svc: h3=":8443"` so browsers may upgrade to HTTP/3 on later requests.

Disable TCP (QUIC-only): `GATEWAY_H3_TCP=0`

## Quick start (dev)

Generate a self-signed certificate:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout deploy/certs/h3.key -out deploy/certs/h3.crt -days 365 \
  -subj '/CN=localhost'
```

Terminal 1 — API (or full stack on `:8080`):

```bash
cargo run -p pertisk-api
```

Terminal 2 — HTTP/3 edge:

```bash
export GATEWAY_H3_CERT=deploy/certs/h3.crt
export GATEWAY_H3_KEY=deploy/certs/h3.key
export GATEWAY_HTTP_UPSTREAM=http://127.0.0.1:8080
cargo run -p pertisk-h3-gateway
```

Test with curl (HTTP/3):

```bash
curl --http3-only --insecure https://localhost:8443/health
```

Test in a browser: open `https://localhost:8443` (accept the self-signed certificate warning). For local UI without TLS, use `http://localhost:8080` directly.

Browsers require a trusted certificate for HTTP/3 in production.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_H3_HOST` | `0.0.0.0` | Bind address (UDP QUIC + TCP HTTPS) |
| `GATEWAY_H3_PORT` | `8443` | Listen port (UDP and TCP) |
| `GATEWAY_H3_CERT` | *(required)* | PEM TLS certificate |
| `GATEWAY_H3_KEY` | *(required)* | PEM TLS private key |
| `GATEWAY_H3_TCP` | `1` | Set `0` to disable TCP HTTPS (QUIC-only) |
| `GATEWAY_HTTP_UPSTREAM` | `http://127.0.0.1:8080` | HTTP/1.1 backend (gateway or API) |

## Production notes

- Place **`pertisk-h3-gateway`** beside **`pertisk-gateway`** on the same host; point `GATEWAY_HTTP_UPSTREAM` at the TCP gateway (`http://127.0.0.1:8080`).
- Open **UDP** and **TCP** port `GATEWAY_H3_PORT` on the firewall.
- Use real certificates (Let's Encrypt, etc.); HTTP/3 requires TLS 1.3.
- Large uploads buffer in memory today (MVP); streaming proxy improvements later.

## MVP limitations

- Reverse proxy only (no HTTP/3 client / upstream QUIC)
- Response bodies buffered before send (not streamed)
- TCP HTTPS responses advertise HTTP/3 via `Alt-Svc`

See [docs/PHASES.md](./PHASES.md) Phase 8.
