"""Relay one public video's byte ranges to local FFmpeg within a bounded job."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import urllib.request


@contextmanager
def range_source(url, headers, budget=35 * 1024 * 1024):
    transferred = 0
    lock = threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_GET(self):
            nonlocal transferred
            if self.path != '/video':
                self.send_error(404); return
            request_headers = {**headers, 'Range':self.headers.get('Range', 'bytes=0-')}
            try:
                request = urllib.request.Request(url, headers=request_headers)
                with urllib.request.urlopen(request, timeout=15) as response:
                    if response.status != 206 or not response.headers.get('Content-Range'):
                        self.send_error(502, 'Public source did not honor byte ranges'); return
                    self.send_response(206)
                    for key in ('Content-Type','Content-Length','Content-Range','Accept-Ranges'):
                        if response.headers.get(key):
                            self.send_header(key,response.headers[key])
                    self.end_headers()
                    while True:
                        chunk = response.read(64 * 1024)
                        if not chunk: break
                        with lock:
                            transferred += len(chunk)
                            if transferred > budget:
                                return
                        self.wfile.write(chunk)
            except (OSError, TimeoutError):
                self.close_connection = True
    server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        yield 'http://127.0.0.1:' + str(server.server_port) + '/video'
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=3)


def select_video(metadata, span):
    formats = [row for row in metadata.get('formats',[]) if row.get('protocol') in ('http','https')
               and row.get('vcodec') not in (None,'none')
               and 0 < float(row.get('height') or 0) <= 720 and not row.get('has_drm')
               and float(row.get('tbr') or 0) * span * 1000 / 8 <= 35 * 1024 * 1024]
    if not formats:
        raise ValueError('No bounded public video format was available')
    return max(formats,key=lambda row:(row.get('acodec') == 'none', row.get('height') or 0,-float(row.get('tbr') or 0)))
