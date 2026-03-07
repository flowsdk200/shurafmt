import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'guardian',
    aliases: ['theguardian'],
    description: 'The Guardian',
    feed: 'https://www.theguardian.com/world/rss',
})
