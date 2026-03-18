import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { MastraServer } from '@mastra/koa'
import { mastra } from './mastra'

const app = new Koa()
const port = process.env.PORT || 3000

app.use(bodyParser())

const server = new MastraServer({ app, mastra })
await server.init()

app.listen(port, () => {
  console.log(`\n🚀 DocGuard Backend is ONLINE!`)
  console.log(`📡 Port : ${port}`)
  console.log(`🔗 Webhook URL Supabase : https://ton-app.onrender.com/api/webhooks/supabase\n`)
})