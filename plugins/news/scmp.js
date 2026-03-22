import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'scmp',
    aliases: [],
    description: 'South China Morning Post',
    feed: 'https://www.scmp.com/rss/91/feed',
})
