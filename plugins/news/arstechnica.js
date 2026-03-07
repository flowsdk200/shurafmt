import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'arstechnica',
    aliases: ['ars'],
    description: 'Ars Technica',
    feed: 'https://arstechnica.com/feed/',
})
