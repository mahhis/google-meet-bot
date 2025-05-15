import { getModelForClass, modelOptions, prop } from '@typegoose/typegoose'

@modelOptions({ schemaOptions: { timestamps: true } })
export class LetterCounter {
  @prop({ required: true })
  id!: string

  @prop({ required: true })
  seq!: number
}

const LetterCounterModel = getModelForClass(LetterCounter)

export async function call() {
  try {
    const updatedCounter = await LetterCounterModel.findOneAndUpdate(
      { id: 'autoval' },
      { $inc: { seq: 1 } },
      { new: true }
    )

    if (!updatedCounter) {
      const newCounter = new LetterCounterModel({ id: 'autoval', seq: 1 })
      await newCounter.save()
    }

    return updatedCounter || { id: 'autoval', seq: 1 }
  } catch (error) {
    // Handle error
    console.error(error)
    throw new Error('Failed to update or create order counter')
  }
}

export async function getCounter() {
  let counter = await LetterCounterModel.findOne({ id: 'autoval' })
  if (!counter) {
    counter = new LetterCounterModel({ id: 'autoval', seq: 1 })
    await counter.save()
  }
  return counter
}
