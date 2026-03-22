import usersDb from '../../src/database/users.js'
import groupsDb from '../../src/database/groups.js'
import { connectMongo } from '../../src/database/mongo.js'

export default {
    name: 'resetdb',
    aliases: ['resetmongo'],
    description: 'Reset seluruh database MongoDB',
    ownerOnly: true,
    execute: async ({ sock, msg, react, useLimit }) => {
        const jid = msg.key.remoteJid

        await react('⏳')

        try {
            const db = await connectMongo()
            const collections = await db.listCollections({}, { nameOnly: true }).toArray()
            for (const c of collections) {
                const name = c?.name
                if (!name) continue
                await db.collection(name).deleteMany({})
            }

            usersDb._data = {}
            usersDb._col = null
            usersDb._initialized = false

            groupsDb._data = {}
            groupsDb._col = null
            groupsDb._initialized = false

            await usersDb.init()
            await groupsDb.init()

            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text: `✅ Database MongoDB berhasil direset total (${collections.length} collection).`
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal reset database: ${err.message}`
            }, { quoted: msg })
        }
    }
}
