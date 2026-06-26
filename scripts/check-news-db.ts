import { initDb, db } from '../server/db.ts'

initDb()
const row = db.prepare("SELECT name FROM sqlite_master WHERE name = 'news_items'").get()
console.log('news_items table:', row)
