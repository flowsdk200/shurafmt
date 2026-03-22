import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'skynews',
    aliases: ['sky'],
    description: 'Sky News',
    feed: 'https://feeds.skynews.com/feeds/rss/world.xml',
})
