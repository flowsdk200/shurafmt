import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'bbc',
    aliases: ['bbcnews', 'global'],
    description: 'BBC News',
    feed: 'https://feeds.bbci.co.uk/news/world/rss.xml',
})
