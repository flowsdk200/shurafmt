import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'bbcworld',
    aliases: ['bbcworld'],
    description: 'BBC World',
    feed: 'https://www.bbc.com/news/world/rss.xml',
})
