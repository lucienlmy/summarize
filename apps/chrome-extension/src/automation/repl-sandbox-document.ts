export function buildSandboxHtml(): string {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
      </head>
      <body>
        <script>
          const formatValue = (value) => {
            if (value == null) return 'null'
            if (typeof value === 'string') return value
            try { return JSON.stringify(value) } catch { return String(value) }
          }

          const toBase64 = (input) => {
            if (typeof input === 'string') {
              return btoa(unescape(encodeURIComponent(input)))
            }
            if (input instanceof ArrayBuffer) {
              const bytes = new Uint8Array(input)
              let binary = ''
              bytes.forEach((b) => { binary += String.fromCharCode(b) })
              return btoa(binary)
            }
            if (ArrayBuffer.isView(input)) {
              const bytes = new Uint8Array(input.buffer)
              let binary = ''
              bytes.forEach((b) => { binary += String.fromCharCode(b) })
              return btoa(binary)
            }
            return btoa(unescape(encodeURIComponent(String(input))))
          }

          const sendRpc = (action, payload) => {
            return new Promise((resolve, reject) => {
              const requestId = \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`
              const handler = (event) => {
                const data = event.data || {}
                if (data.source !== 'summarize-repl' || data.type !== 'rpc-result') return
                if (data.requestId !== requestId) return
                window.removeEventListener('message', handler)
                if (data.ok) resolve(data.result)
                else reject(new Error(data.error || 'RPC failed'))
              }
              window.addEventListener('message', handler)
              window.parent.postMessage(
                { source: 'summarize-repl', type: 'rpc', requestId, action, payload },
                '*'
              )
            })
          }

          window.addEventListener('message', async (event) => {
            const data = event.data || {}
            if (data.source !== 'summarize-repl' || data.type !== 'execute') return

            const { requestId, code } = data
            const logs = []
            const files = []

            const original = { ...console }
            const capture = (...args) => {
              logs.push(args.map((arg) => formatValue(arg)).join(' '))
            }
            console.log = (...args) => { capture(...args); original.log(...args) }
            console.info = (...args) => { capture(...args); original.info(...args) }
            console.warn = (...args) => { capture(...args); original.warn(...args) }
            console.error = (...args) => { capture(...args); original.error(...args) }

            const browserjs = async (fn, ...args) => {
              if (typeof fn !== 'function') throw new Error('browserjs() expects a function')
              const result = await sendRpc('browserjs', { fnSource: fn.toString(), args })
              if (result && typeof result === 'object' && '__browserLogs' in result) {
                const payload = result
                if (Array.isArray(payload.__browserLogs)) {
                  logs.push(...payload.__browserLogs)
                }
                return payload.value
              }
              return result
            }

            const navigate = async (args) => sendRpc('navigate', args)

            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

            const listArtifacts = async () => sendRpc('listArtifacts', {})
            const getArtifact = async (fileName, options) =>
              sendRpc('getArtifact', { fileName, ...(options || {}) })
            const createOrUpdateArtifact = async (fileName, content, mimeType) =>
              sendRpc('createOrUpdateArtifact', { fileName, content, mimeType })
            const deleteArtifact = async (fileName) =>
              sendRpc('deleteArtifact', { fileName })

            const returnFile = (fileNameOrObj, maybeContent, maybeMimeType) => {
              let fileName = ''
              let content = ''
              let mimeType = 'text/plain'
              if (typeof fileNameOrObj === 'object' && fileNameOrObj) {
                fileName = fileNameOrObj.fileName || fileNameOrObj.name || ''
                content = fileNameOrObj.content ?? ''
                mimeType = fileNameOrObj.mimeType || fileNameOrObj.type || mimeType
              } else {
                fileName = String(fileNameOrObj || '')
                content = maybeContent ?? ''
                mimeType = maybeMimeType || mimeType
              }
              if (!fileName) {
                throw new Error('returnFile() requires a fileName')
              }
              const contentBase64 = toBase64(content)
              files.push({ fileName, mimeType, contentBase64 })
            }

            try {
              const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
              const fn = new AsyncFunction(
                'browserjs',
                'navigate',
                'sleep',
                'returnFile',
                'createOrUpdateArtifact',
                'getArtifact',
                'listArtifacts',
                'deleteArtifact',
                'console',
                code
              )
              const result = await fn(
                browserjs,
                navigate,
                sleep,
                returnFile,
                createOrUpdateArtifact,
                getArtifact,
                listArtifacts,
                deleteArtifact,
                console
              )
              if (result !== undefined) {
                logs.push(\`=> \${formatValue(result)}\`)
              }
              window.parent.postMessage(
                { source: 'summarize-repl', type: 'result', requestId, ok: true, logs, files },
                '*'
              )
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              window.parent.postMessage(
                { source: 'summarize-repl', type: 'result', requestId, ok: false, error: message, logs, files },
                '*'
              )
            } finally {
              console.log = original.log
              console.info = original.info
              console.warn = original.warn
              console.error = original.error
            }
          })
        </script>
      </body>
    </html>
  `;
}
