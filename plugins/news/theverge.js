import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'theverge',
    aliases: ['verge'],
    description: 'The Verge',
    feed: 'https://www.theverge.com/rss/index.xml',
})
