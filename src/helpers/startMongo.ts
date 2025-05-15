import env from '@/helpers/env'
import mongoose, { connect } from 'mongoose'

function startMongo() {
  mongoose.set('strictQuery', false)
  return connect(env.MONGO)
}

export default startMongo
