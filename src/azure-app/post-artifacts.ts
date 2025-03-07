import { app } from '@azure/functions'
import { handler } from '../azure-function.js'

app.http('PostArtifacts', {
  route: 'artifacts',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: handler,
})
