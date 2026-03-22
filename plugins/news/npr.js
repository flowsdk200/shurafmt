import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'npr',
    aliases: ['npr-news'],
    description: 'NPR News',
    feed: 'https://www.npr.org/rss/rss.php?id=1001',
})
