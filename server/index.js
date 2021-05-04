const http = require('http')
const https = require('https')
const path = require('path')
const express = require('express')
const socketIo = require('socket.io')
const needle = require('needle')
const bodyParser = require('body-parser')
const ObjectsToCsv = require('objects-to-csv')
const config = require('dotenv').config()

const TOKEN = process.env.TWITTER_BEARER_TOKEN
const PORT = process.env.PORT || 3000

const app = express()

const server = http.createServer(app)
const io = socketIo(server)
let isPaused = false

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: true}))

app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../', 'client', 'index.html'))
})

app.get('/file', (req, res) => {
  const file = path.resolve(__dirname, '../', 'tweets.csv')
  res.download(file)
})

app.post('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../', 'client', 'index.html'))
})

const rulesURL = 'https://api.twitter.com/2/tweets/search/stream/rules'
const streamURL =
  'https://api.twitter.com/2/tweets/search/stream?tweet.fields=public_metrics&expansions=author_id'

  //array of rules/keyword
let rules = []

// Get stream rules 
async function getRules() {
  const response = await needle('get', rulesURL, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
  })
  //console.log(response.body)
  return response.body
}

// Set stream rules
async function setRules() {
  const data = {
    add: rules,
  }

  const response = await needle('post', rulesURL, data, {
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
  })

  return response.body
}

// Delete stream rules
async function deleteRules(rules) {
  if (!Array.isArray(rules.data)) {
    return null
  }

  const ids = rules.data.map((rule) => rule.id)

  const data = {
    delete: {
      ids: ids,
    },
  }

  const response = await needle('post', rulesURL, data, {
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
  })

  return response.body
}

function streamTweets(socket) {
  const stream = needle.get(streamURL, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
  })

  stream.on('data', async (data) => {
    try {
      const json = JSON.parse(data)

      socket.emit('tweet', json)

      const dataCsv = [
          { id: json.data.id.toString() ,
            text: json.data.text.toString(),
            authorId: json.data.author_id.toString(),
            retweetCount: json.data.public_metrics.retweet_count.toString(),
            replyCount: json.data.public_metrics.reply_count.toString(),
            likeCount: json.data.public_metrics.like_count.toString(),
            quoteCount: json.data.public_metrics.quote_count.toString(),
            name: json.includes.users[0].name.toString(),
            username: json.includes.users[0].username.toString(),
            created_at: (new Date()).toString(),
          }]

      const csv = new ObjectsToCsv(dataCsv)
      await csv.toDisk('./tweets.csv', { append: true })
    } catch (error) {
      console.error(error)
    }
  })

  return stream
}

io.on('connection', async (socket) => {
  console.log('Client connected...')

  const keywords = socket.handshake.query['keyword'].split(' ') // { value: 'dogecoin'}, { value: 'tothemoon'}
  rules = []
  for (const keyword of keywords){
    rules.push({value: keyword})
  }

  let currentRules
  try {
    //   Get all stream rules
    currentRules = await getRules()

    // Delete all stream rules
    await deleteRules(currentRules)

    // Set rules based on array above
    await setRules()
  } catch (error) {
    console.error(error)
    process.exit(1)
  }

  const filteredStream = streamTweets(io)

  let timeout = 0
  filteredStream.on('timeout', () => {
    // Reconnect on error
    console.warn('A connection error occurred. Reconnecting…')
    setTimeout(() => {
      timeout++
      streamTweets(io)
    }, 2 ** timeout)
    streamTweets(io)
  })
})

server.listen(PORT, () => console.log(`Listening on port ${PORT}`))