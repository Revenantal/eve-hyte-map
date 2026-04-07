export function createSseHub({ heartbeatMs = 25000 } = {}) {
  const clients = new Set();
  let heartbeatTimer = null;

  function startHeartbeat() {
    if (heartbeatTimer) {
      return;
    }

    heartbeatTimer = setInterval(() => {
      for (const client of clients) {
        client.write(': heartbeat\n\n');
      }
    }, heartbeatMs);
    heartbeatTimer.unref?.();
  }

  function stopHeartbeat() {
    if (!heartbeatTimer || clients.size > 0) {
      return;
    }

    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  return {
    addClient(response) {
      clients.add(response);
      startHeartbeat();

      response.on('close', () => {
        clients.delete(response);
        stopHeartbeat();
      });
    },
    broadcast(eventName, payload) {
      const body = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of clients) {
        client.write(body);
      }
    },
    getClientCount() {
      return clients.size;
    },
    closeAll() {
      for (const client of clients) {
        client.end();
      }
      clients.clear();
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  };
}
