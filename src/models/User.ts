import {
  Severity,
  getModelForClass,
  modelOptions,
  prop,
} from '@typegoose/typegoose'

@modelOptions({
  schemaOptions: { timestamps: true },
  options: {
    allowMixed: Severity.ALLOW,
  },
})
export class User {
  @prop({ required: true, index: true, unique: true })
  id!: number
  @prop({})
  username?: string
  @prop({ required: true, default: 'en' })
  language!: string
  @prop({})
  googleMeetLink?: string

  // OAuth-related properties
  @prop({ default: false })
  isAuthorized!: boolean
  @prop({})
  refreshToken?: string
  @prop({})
  accessToken?: string
  @prop({})
  tokenExpiry?: Date
}

export const UserModel = getModelForClass(User)

export function findOrCreateUser(id: number) {
  return UserModel.findOneAndUpdate(
    { id },
    {},
    {
      upsert: true,
      new: true,
    }
  )
}
