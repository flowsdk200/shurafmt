import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'hackernews',
    aliases: ['hn'],
    description: 'Hacker News',
    feed: 'https://news.ycombinator.com/rss',
})
