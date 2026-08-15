// Wireless controller (#215): a tiny embedded HTTP+WebSocket server so a phone
// on the same network (or Tailscale) can open the SAME control panel in a
// browser -- no app install. The static files are include_str!'d from the
// real src/ directory at compile time (same bytes the desktop webview loads
// via Tauri's own asset protocol), so there's no runtime path resolution and
// nothing to keep in sync by hand.
//
// Protocol: every WS message is the full `{active, adj, fx}` JSON blob one
// side just changed. The server does no interpretation -- it caches the
// latest blob (so a newly-connected client syncs immediately) and rebroadcasts
// verbatim to every other connected client. Last-write-wins; the JS side
// ignores an echo of its own last-sent payload (see connectWS() in main.js).
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::header,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use std::net::UdpSocket;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};

pub const PORT: u16 = 8917;

#[derive(Clone)]
struct AppState {
    latest: Arc<Mutex<Option<String>>>,
    tx: broadcast::Sender<String>,
}

fn html(body: &'static str) -> Response {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response()
}
fn js(body: &'static str) -> Response {
    ([(header::CONTENT_TYPE, "text/javascript; charset=utf-8")], body).into_response()
}
fn css(body: &'static str) -> Response {
    ([(header::CONTENT_TYPE, "text/css; charset=utf-8")], body).into_response()
}
fn manifest(body: &'static str) -> Response {
    (
        [(header::CONTENT_TYPE, "application/manifest+json")],
        body,
    )
        .into_response()
}
fn png(bytes: &'static [u8]) -> Response {
    ([(header::CONTENT_TYPE, "image/png")], bytes).into_response()
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    if let Some(snapshot) = state.latest.lock().await.clone() {
        let _ = sender.send(Message::text(snapshot)).await;
    }

    let mut rx = state.tx.subscribe();
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::text(msg)).await.is_err() {
                break;
            }
        }
    });

    let recv_state = state.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Ok(text) = msg.into_text() {
                let text = text.to_string();
                *recv_state.latest.lock().await = Some(text.clone());
                let _ = recv_state.tx.send(text);
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}

pub fn local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

pub async fn start() {
    let (tx, _rx) = broadcast::channel::<String>(64);
    let state = AppState {
        latest: Arc::new(Mutex::new(None)),
        tx,
    };

    let app = Router::new()
        .route("/", get(|| async { html(include_str!("../../src/index.html")) }))
        .route("/main.js", get(|| async { js(include_str!("../../src/main.js")) }))
        .route("/engine.js", get(|| async { js(include_str!("../../src/engine.js")) }))
        .route("/pieces.js", get(|| async { js(include_str!("../../src/pieces.js")) }))
        .route("/styles.css", get(|| async { css(include_str!("../../src/styles.css")) }))
        .route(
            "/vendor/tweakpane.js",
            get(|| async { js(include_str!("../../src/vendor/tweakpane.js")) }),
        )
        .route(
            "/manifest.webmanifest",
            get(|| async { manifest(include_str!("../../src/manifest.webmanifest")) }),
        )
        .route(
            "/icons/icon-192.png",
            get(|| async { png(include_bytes!("../../src/icons/icon-192.png")) }),
        )
        .route(
            "/icons/icon-512.png",
            get(|| async { png(include_bytes!("../../src/icons/icon-512.png")) }),
        )
        .route("/ws", get(ws_handler))
        .with_state(state);

    match tokio::net::TcpListener::bind(("0.0.0.0", PORT)).await {
        Ok(listener) => {
            let _ = axum::serve(listener, app).await;
        }
        Err(e) => eprintln!("pl-vj-studio controller server failed to bind :{PORT}: {e}"),
    }
}
