// MCP transport handler — routes all spec methods through message bus.
// Message shapes from mcp-schema.json. Config from transport.schema.json + runtime.schema.json.

function jsonrpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function jsonrpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function jsonrpcNotification(method, params) {
  return { jsonrpc: '2.0', method, params }
}

export function createTransport(bus, {
  toolList,
  serverInfo,
  protocolVersion,
  errorCodes,
  capabilities
}) {

  // --- Validate incoming JSON-RPC ---

  bus.handle('validate', (msg) => {
    if (msg.jsonrpc !== '2.0') {
      throw new Error('Invalid JSON-RPC: missing jsonrpc 2.0')
    }
    if (!msg.method && msg.id === undefined) {
      throw new Error('Invalid JSON-RPC: missing method or id')
    }
    return msg
  })

  // --- State ---

  let logLevel = 'info'
  const subscriptions = new Map()  // uri → Set<reqId>
  const inFlight = new Map()       // requestId → { cancel: () => void }

  // --- Route incoming messages ---

  bus.handle('route', async (msg, reqId) => {
    const { method, params, id } = msg

    switch (method) {

      // ===== Lifecycle =====

      case 'initialize':
        return jsonrpcResult(id, {
          protocolVersion,
          capabilities,
          serverInfo
        })

      case 'notifications/initialized':
        return null

      case 'ping':
        return jsonrpcResult(id, {})

      // ===== Tools =====

      case 'tools/list':
        return jsonrpcResult(id, { tools: toolList })

      case 'tools/call': {
        const name = params.name
        const args = params.arguments || {}
        try {
          const result = await bus.send('dispatch', { name, arguments: args }, reqId)
          return jsonrpcResult(id, {
            content: [{ type: 'text', text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2) }]
          })
        } catch (err) {
          return jsonrpcResult(id, {
            content: [{ type: 'text', text: 'Error: ' + err.message }], isError: true
          })
        }
      }

      // ===== Resources =====

      case 'resources/list': {
        try {
          const result = await bus.send('resources/list', params || {}, reqId)
          return jsonrpcResult(id, result)
        } catch {
          return jsonrpcResult(id, { resources: [] })
        }
      }

      case 'resources/templates/list': {
        try {
          const result = await bus.send('resources/templates/list', params || {}, reqId)
          return jsonrpcResult(id, result)
        } catch {
          return jsonrpcResult(id, { resourceTemplates: [] })
        }
      }

      case 'resources/read': {
        try {
          const result = await bus.send('resources/read', params, reqId)
          return jsonrpcResult(id, result)
        } catch (err) {
          return jsonrpcResult(id, {
            contents: [{ uri: params?.uri, text: 'Error: ' + err.message }]
          })
        }
      }

      case 'resources/subscribe': {
        const uri = params?.uri
        if (uri) {
          if (!subscriptions.has(uri)) subscriptions.set(uri, new Set())
          subscriptions.get(uri).add(reqId)
        }
        return jsonrpcResult(id, {})
      }

      case 'resources/unsubscribe': {
        const uri = params?.uri
        if (uri && subscriptions.has(uri)) {
          subscriptions.get(uri).delete(reqId)
          if (subscriptions.get(uri).size === 0) subscriptions.delete(uri)
        }
        return jsonrpcResult(id, {})
      }

      // ===== Prompts =====

      case 'prompts/list': {
        try {
          const result = await bus.send('prompts/list', params || {}, reqId)
          return jsonrpcResult(id, result)
        } catch {
          return jsonrpcResult(id, { prompts: [] })
        }
      }

      case 'prompts/get': {
        try {
          const result = await bus.send('prompts/get', params, reqId)
          return jsonrpcResult(id, result)
        } catch (err) {
          return jsonrpcError(id, errorCodes.INVALID_PARAMS, err.message)
        }
      }

      // ===== Completion =====

      case 'completion/complete': {
        try {
          const result = await bus.send('completion/complete', params, reqId)
          return jsonrpcResult(id, result)
        } catch {
          return jsonrpcResult(id, { completion: { values: [] } })
        }
      }

      // ===== Logging =====

      case 'logging/setLevel': {
        logLevel = params?.level || 'info'
        bus.send('logging/setLevel', { level: logLevel }, reqId).catch(() => {})
        return jsonrpcResult(id, {})
      }

      // ===== Cancellation =====

      case 'notifications/cancelled': {
        const cancelId = params?.requestId
        if (cancelId && inFlight.has(cancelId)) {
          const entry = inFlight.get(cancelId)
          if (entry.cancel) entry.cancel()
          inFlight.delete(cancelId)
        }
        return null
      }

      // ===== Unknown =====

      default:
        return jsonrpcError(id, errorCodes.METHOD_NOT_FOUND, 'Method not found: ' + method)
    }
  })

  // --- Server → Client notification builders ---

  return {
    notifyToolsChanged: () => jsonrpcNotification('notifications/tools/list_changed', {}),
    notifyResourcesChanged: () => jsonrpcNotification('notifications/resources/list_changed', {}),
    notifyResourceUpdated: (uri) => jsonrpcNotification('notifications/resources/updated', { uri }),
    notifyPromptsChanged: () => jsonrpcNotification('notifications/prompts/list_changed', {}),
    notifyProgress: (progressToken, progress, total, message) =>
      jsonrpcNotification('notifications/progress', { progressToken, progress, total, message }),
    notifyLog: (level, logger, data) =>
      jsonrpcNotification('notifications/message', { level, logger, data }),

    get logLevel() { return logLevel },
    subscriptions,
    inFlight
  }
}
