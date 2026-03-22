import { MongoClient, ServerApiVersion } from 'mongodb'
import config from '../../config.js'
import logger from '../utils/logger.js'

let client = null
let db = null

const getUri = () => {
    const raw =
        config.mongoUri ||
        process.env.MONGODB_URI ||
        process.env.MONGO_URL ||
        process.env.DATABASE_URL ||
        ''

    let uri = String(raw).trim()

    // Handle common env formatting mistakes: wrapped quotes/newline
    if ((uri.startsWith('"') && uri.endsWith('"')) || (uri.startsWith("'") && uri.endsWith("'"))) {
        uri = uri.slice(1, -1).trim()
    }

    return uri
}
const getDbNameFallback = () => process.env.MONGODB_DB || process.env.MONGO_DB || config.botName || 'shurafmt'

const validateUri = (uri) => uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')

const getDbNameFromUri = (uri) => {
    try {
        const u = new URL(uri)
        const name = (u.pathname || '').replace(/^\//, '').trim()
        return name || ''
    } catch {
        return ''
    }
}

export const connectMongo = async () => {
    if (db) return db

    const uri = getUri()
    if (!validateUri(uri)) {
        throw new Error('Mongo URI invalid. Pastikan diawali mongodb:// atau mongodb+srv://')
    }

    const dbNameFromUri = getDbNameFromUri(uri)
    const dbName = dbNameFromUri || getDbNameFallback()
    if (!dbNameFromUri) {
        logger.warn(`mongodb uri tanpa db name, fallback ke '${dbName}'`)
    }

    client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: false,
            deprecationErrors: true,
        }
    })
    await client.connect()
    db = client.db(dbName)
    await db.command({ ping: 1 })
    logger.ready(`Connected mongodb to ${db.databaseName}`)
    return db
}

export const getCollection = async (name) => {
    const database = await connectMongo()
    return database.collection(name)
}

export const closeMongo = async () => {
    if (!client) return
    await client.close()
    client = null
    db = null
}
