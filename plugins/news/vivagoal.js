import https from 'https'
import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'vivagoal',
    aliases: ['vgoal', 'viva'],
    description: 'Vivagoal',
    feed: 'https://vivagoal.com/feed/',
    axiosConfig: {
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
    }
})
