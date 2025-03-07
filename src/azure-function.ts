import { Readable } from 'stream'
import { Cookie, HttpHandler, HttpResponseInit } from '@azure/functions'
import { FastifyInstance, InjectOptions } from 'fastify'
import { createApp } from './app.js'

async function convertToNodeReadable(
  webStream: ReadableStream<Uint8Array>,
): Promise<Readable> {
  const reader = webStream.getReader()

  return new Readable({
    async read() {
      const { done, value } = await reader.read()
      if (done) {
        this.push(null) // End the stream
      } else {
        this.push(Buffer.from(value)) // Convert Uint8Array to Buffer
      }
    },
  })
}

const azureFunctionFastify = (app: FastifyInstance) => {
  const handler: HttpHandler = async (request, context) => {
    const method = request.method
    const url = request.url
    const query: InjectOptions['query'] = (() => {
      const q = {}
      for (const key in request.query) {
        q[key] = request.query[key]
      }
      return q
    })()
    const headers: InjectOptions['headers'] = (() => {
      const h = {}
      for (const [key, value] of request.headers.entries()) {
        h[key.toLowerCase()] = value
      }
      return h
    })()
    const payload = await (async () => {
      if (!request.body) {
        return null
      }
      const p = await convertToNodeReadable(
        request.body as ReadableStream<Uint8Array>,
      )
      return p
    })()

    const prom = new Promise<HttpResponseInit>((resolve, reject) => {
      app.inject(
        {
          method,
          url,
          query,
          payload,
          headers,
        } as InjectOptions,
        (err, res) => {
          if (err) {
            resolve({
              status: 500,
              body: '',
              headers: {},
            })
          } else {
            let payload
            const headers: Record<string, string> = {}

            for (const key in res?.headers) {
              headers[key] = `${res?.headers[key]}`
            }

            const isOctetStream =
              headers['content-type'] === 'application/octet-stream'

            console.debug('isOctetStream', isOctetStream)
            if (isOctetStream) {
              payload = res?.stream()
            } else {
              payload = res?.payload
            }

            context.debug('payload', payload)

            if (isOctetStream) {
              headers['content-length'] = `${res?.rawPayload?.length}`
              Reflect.deleteProperty(headers, 'transfer-encoding')
            }

            context.debug('headers', headers)

            resolve({
              status: res?.statusCode,
              body: payload,
              headers: headers,
              cookies: res?.cookies as Cookie[],
            })
          }
        },
      )
    })
    return prom
  }
  return handler
}

const app = createApp({
  trustProxy: true,
})

export const handler = azureFunctionFastify(app)
