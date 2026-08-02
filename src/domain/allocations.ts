export type AllocationTargetType = 'PURCHASE' | 'SALE'

export type Allocation = {
  id: string
  sourceId: string
  targetId: string
  targetType: AllocationTargetType
  amountNPR: number
  createdAt: string
  updatedAt: string
}

export type AllocationTarget = {
  id: string
  totalNPR: number
}

export type AllocationValidationError = {
  field: string
  message: string
}

const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100

export function sumAllocations(allocations: Pick<Allocation, 'amountNPR'>[]) {
  return money(allocations.reduce((sum, allocation) => sum + Number(allocation.amountNPR || 0), 0))
}

export function unallocatedPaymentBalance(paymentAmountNPR: number, allocations: Pick<Allocation, 'amountNPR'>[]) {
  return money(Number(paymentAmountNPR || 0) - sumAllocations(allocations))
}

export function targetOutstandingBalance(
  targetTotalNPR: number,
  allocations: Pick<Allocation, 'amountNPR'>[],
) {
  return money(Number(targetTotalNPR || 0) - sumAllocations(allocations))
}

export function validateAllocations(input: {
  sourceAmountNPR: number
  allocations: Allocation[]
  targets: AllocationTarget[]
  existingAllocations?: Allocation[]
}) {
  const errors: AllocationValidationError[] = []
  const targetsById = new Map(input.targets.map((target) => [target.id, target]))
  const allocationsByTarget = new Map<string, Allocation[]>()

  for (const allocation of input.allocations) {
    if (allocation.amountNPR <= 0) {
      errors.push({ field: 'allocations', message: 'Allocation amount must be greater than zero.' })
    }

    if (!targetsById.has(allocation.targetId)) {
      errors.push({ field: 'allocations', message: `Allocation target ${allocation.targetId} was not found.` })
    }

    allocationsByTarget.set(allocation.targetId, [
      ...(allocationsByTarget.get(allocation.targetId) ?? []),
      allocation,
    ])
  }

  if (sumAllocations(input.allocations) > money(input.sourceAmountNPR)) {
    errors.push({ field: 'amountNPR', message: 'Allocations cannot exceed the payment or receipt amount.' })
  }

  for (const [targetId, targetAllocations] of allocationsByTarget) {
    const target = targetsById.get(targetId)
    if (!target) {
      continue
    }

    const previousAllocated = sumAllocations(
      (input.existingAllocations ?? []).filter((allocation) => allocation.targetId === targetId),
    )
    const newAllocated = sumAllocations(targetAllocations)

    if (money(previousAllocated + newAllocated) > money(target.totalNPR)) {
      errors.push({
        field: 'allocations',
        message: `Allocations exceed outstanding balance for target ${targetId}.`,
      })
    }
  }

  return { valid: errors.length === 0, errors }
}

export function createSequentialAllocations(input: {
  idFactory: () => string
  sourceId: string
  sourceAmountNPR: number
  targetType: AllocationTargetType
  targets: AllocationTarget[]
  existingAllocations?: Allocation[]
  timestamp: string
}) {
  let remaining = money(input.sourceAmountNPR)
  const allocations: Allocation[] = []

  for (const target of input.targets) {
    if (remaining <= 0) {
      break
    }

    const alreadyAllocated = sumAllocations(
      (input.existingAllocations ?? []).filter((allocation) => allocation.targetId === target.id),
    )
    const outstanding = money(target.totalNPR - alreadyAllocated)
    const amountNPR = money(Math.min(remaining, Math.max(0, outstanding)))

    if (amountNPR <= 0) {
      continue
    }

    allocations.push({
      id: input.idFactory(),
      sourceId: input.sourceId,
      targetId: target.id,
      targetType: input.targetType,
      amountNPR,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    remaining = money(remaining - amountNPR)
  }

  return allocations
}
