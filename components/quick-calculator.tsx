'use client'

import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calculator as CalcIcon,
  Check,
  Copy,
  Delete,
  History,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type HistoryItem = {
  expression: string
  result: string
}

export function QuickCalculator({ className }: { className?: string }) {
  const [display, setDisplay] = useState('0')
  const [expression, setExpression] = useState('')
  const [prevVal, setPrevVal] = useState<number | null>(null)
  const [operator, setOperator] = useState<string | null>(null)
  const [waitingForOperand, setWaitingForOperand] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [copied, setCopied] = useState(false)

  // Clear all
  const clearAll = useCallback(() => {
    setDisplay('0')
    setExpression('')
    setPrevVal(null)
    setOperator(null)
    setWaitingForOperand(false)
  }, [])

  // Handle digit press
  const inputDigit = useCallback(
    (digit: string) => {
      if (waitingForOperand) {
        setDisplay(digit)
        setWaitingForOperand(false)
      } else {
        setDisplay(prev => (prev === '0' ? digit : prev + digit))
      }
    },
    [waitingForOperand]
  )

  // Handle decimal point
  const inputDecimal = useCallback(() => {
    if (waitingForOperand) {
      setDisplay('0.')
      setWaitingForOperand(false)
      return
    }
    if (!display.includes('.')) {
      setDisplay(prev => prev + '.')
    }
  }, [display, waitingForOperand])

  // Handle backspace
  const handleDelete = useCallback(() => {
    if (waitingForOperand) return
    setDisplay(prev => {
      if (prev.length <= 1 || (prev.length === 2 && prev.startsWith('-'))) {
        return '0'
      }
      return prev.slice(0, -1)
    })
  }, [waitingForOperand])

  // Handle toggle sign (+/-)
  const toggleSign = useCallback(() => {
    setDisplay(prev => {
      const num = parseFloat(prev)
      if (isNaN(num) || num === 0) return prev
      return (num * -1).toString()
    })
  }, [])

  // Execute binary operation
  const calculate = useCallback(
    (first: number, second: number, op: string): number => {
      switch (op) {
        case '+':
          return first + second
        case '-':
          return first - second
        case '×':
        case '*':
          return first * second
        case '÷':
        case '/':
          return second !== 0 ? first / second : 0
        default:
          return second
      }
    },
    []
  )

  // Handle operator button (+, -, ×, ÷)
  const performOperation = useCallback(
    (nextOperator: string) => {
      const inputValue = parseFloat(display)

      if (prevVal === null) {
        setPrevVal(inputValue)
        setExpression(`${inputValue} ${nextOperator}`)
      } else if (operator) {
        const currentVal = prevVal || 0
        const result = calculate(currentVal, inputValue, operator)

        setPrevVal(result)
        setDisplay(String(Number(result.toFixed(6))))
        setExpression(`${Number(result.toFixed(6))} ${nextOperator}`)
      }

      setWaitingForOperand(true)
      setOperator(nextOperator)
    },
    [display, prevVal, operator, calculate]
  )

  // Handle Equals (=)
  const handleEquals = useCallback(() => {
    if (operator === null || prevVal === null) return

    const inputValue = parseFloat(display)
    const result = calculate(prevVal, inputValue, operator)
    const formattedResult = String(Number(result.toFixed(6)))
    const fullExpr = `${prevVal} ${operator} ${inputValue} =`

    setHistory(prev =>
      [{ expression: fullExpr, result: formattedResult }, ...prev].slice(0, 10)
    )

    setDisplay(formattedResult)
    setExpression('')
    setPrevVal(null)
    setOperator(null)
    setWaitingForOperand(true)
  }, [operator, prevVal, display, calculate])

  // Handle Quick POS Percentages (e.g., -10%, +15%)
  const applyQuickPercentage = useCallback(
    (percentValue: number, isAddition: boolean) => {
      const current = parseFloat(display)
      if (isNaN(current) || current === 0) return

      const delta = (current * percentValue) / 100
      const finalVal = isAddition ? current + delta : current - delta
      const formatted = String(Number(finalVal.toFixed(2)))
      const signStr = isAddition ? '+' : '-'
      const exprStr = `${current} ${signStr} ${percentValue}%`

      setHistory(prev =>
        [{ expression: exprStr, result: formatted }, ...prev].slice(0, 10)
      )

      setDisplay(formatted)
      setExpression(exprStr)
      setWaitingForOperand(true)
    },
    [display]
  )

  // Copy result to clipboard
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(display)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [display])

  // Keyboard navigation listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return
      }

      if (e.key >= '0' && e.key <= '9') inputDigit(e.key)
      else if (e.key === '.') inputDecimal()
      else if (e.key === '+' || e.key === '-') performOperation(e.key)
      else if (e.key === '*') performOperation('×')
      else if (e.key === '/') performOperation('÷')
      else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault()
        handleEquals()
      } else if (e.key === 'Backspace') handleDelete()
      else if (e.key === 'Escape' || e.key.toLowerCase() === 'c') clearAll()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    inputDigit,
    inputDecimal,
    performOperation,
    handleEquals,
    handleDelete,
    clearAll,
  ])

  return (
    <div
      className={cn(
        'w-84 select-none rounded-2xl border border-border/80 bg-card p-4 text-card-foreground shadow-2xl backdrop-blur-xl',
        className
      )}
    >
      {/* Header Bar */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CalcIcon className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-xs text-foreground tracking-wide uppercase">
                POS Smart Calc
              </span>
              <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <Sparkles className="size-2.5" /> PRO
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowHistory(prev => !prev)}
            className={cn(
              'rounded-lg p-1.5 transition-all cursor-pointer',
              showHistory
                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
            title="History"
          >
            <History className="size-4" />
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 transition-all cursor-pointer"
            title="Reset (C)"
          >
            <RotateCcw className="size-4" />
          </button>
        </div>
      </div>

      {/* Screen Display (High Contrast OLED style for both Light and Dark modes) */}
      <div className="relative mb-3 flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-3 text-white shadow-inner">
        <div className="min-h-5 text-right font-mono text-xs text-slate-400 tracking-tight truncate w-full">
          {expression || '\u00A0'}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 transition-all hover:bg-slate-700 active:scale-95 cursor-pointer"
            title="Copy value"
          >
            {copied ? (
              <>
                <Check className="size-3 text-emerald-400" />
                <span className="text-emerald-400 font-semibold">Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3" />
                <span>Copy</span>
              </>
            )}
          </button>

          <span className="font-mono text-2xl font-bold tracking-wider text-emerald-400 truncate max-w-56 drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]">
            {display}
          </span>
        </div>
      </div>

      {/* History Drawer */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mb-3 overflow-hidden rounded-xl border border-border/80 bg-muted/40 p-2.5 text-xs"
          >
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
              <span>Calculation History</span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHistory([])}
                  className="text-[10px] text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                >
                  Clear history
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="py-2 text-center text-muted-foreground text-[11px]">
                No history recorded
              </div>
            ) : (
              <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                {history.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setDisplay(item.result)
                      setShowHistory(false)
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/80 text-left transition-colors cursor-pointer"
                  >
                    <span className="text-muted-foreground font-mono truncate text-[11px]">
                      {item.expression}
                    </span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 ml-2">
                      {item.result}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* POS Quick Percentages Strip */}
      <div className="mb-3">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          POS Quick Percentages
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => applyQuickPercentage(5, false)}
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 py-1 text-center text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-all cursor-pointer"
          >
            -5%
          </button>
          <button
            type="button"
            onClick={() => applyQuickPercentage(10, false)}
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 py-1 text-center text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-all cursor-pointer"
          >
            -10%
          </button>
          <button
            type="button"
            onClick={() => applyQuickPercentage(15, false)}
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 py-1 text-center text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-all cursor-pointer"
          >
            -15%
          </button>
          <button
            type="button"
            onClick={() => applyQuickPercentage(20, false)}
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 py-1 text-center text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-all cursor-pointer"
          >
            -20%
          </button>

          <button
            type="button"
            onClick={() => applyQuickPercentage(5, true)}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-1 text-center text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition-all cursor-pointer"
          >
            +5%
          </button>
          <button
            type="button"
            onClick={() => applyQuickPercentage(10, true)}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-1 text-center text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition-all cursor-pointer"
          >
            +10%
          </button>
          <button
            type="button"
            onClick={() => applyQuickPercentage(15, true)}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-1 text-center text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition-all cursor-pointer"
          >
            +15%
          </button>
          <button
            type="button"
            onClick={() => applyQuickPercentage(20, true)}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-1 text-center text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition-all cursor-pointer"
          >
            +20%
          </button>
        </div>
      </div>

      {/* Main Tactile Keypad */}
      <div className="grid grid-cols-4 gap-1.5 font-medium">
        {/* Row 1 */}
        <button
          type="button"
          onClick={clearAll}
          className="rounded-xl border border-rose-500/30 bg-rose-500/15 py-2.5 text-xs font-bold text-rose-600 dark:text-rose-300 hover:bg-rose-500/25 active:scale-95 transition-all cursor-pointer"
        >
          AC
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="flex items-center justify-center rounded-xl border border-border/80 bg-muted/80 py-2.5 text-xs text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer"
        >
          <Delete className="size-4" />
        </button>
        <button
          type="button"
          onClick={toggleSign}
          className="rounded-xl border border-border/80 bg-muted/80 py-2.5 text-sm font-semibold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer"
        >
          ±
        </button>
        <button
          type="button"
          onClick={() => performOperation('÷')}
          className="rounded-xl border border-indigo-500/30 bg-indigo-500/15 py-2.5 text-base font-bold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25 active:scale-95 transition-all cursor-pointer"
        >
          ÷
        </button>

        {/* Row 2 */}
        <button
          type="button"
          onClick={() => inputDigit('7')}
          className="rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          7
        </button>
        <button
          type="button"
          onClick={() => inputDigit('8')}
          className="rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          8
        </button>
        <button
          type="button"
          onClick={() => inputDigit('9')}
          className="rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          9
        </button>
        <button
          type="button"
          onClick={() => performOperation('×')}
          className="rounded-xl border border-indigo-500/30 bg-indigo-500/15 py-2.5 text-base font-bold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25 active:scale-95 transition-all cursor-pointer"
        >
          ×
        </button>

        {/* Row 3 */}
        <button
          type="button"
          onClick={() => inputDigit('4')}
          className="rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          4
        </button>
        <button
          type="button"
          onClick={() => inputDigit('5')}
          className="rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          5
        </button>
        <button
          type="button"
          onClick={() => inputDigit('6')}
          className="rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          6
        </button>
        <button
          type="button"
          onClick={() => performOperation('-')}
          className="rounded-xl border border-indigo-500/30 bg-indigo-500/15 py-2.5 text-base font-bold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25 active:scale-95 transition-all cursor-pointer"
        >
          -
        </button>

        {/* Row 4 */}
        <button
          type="button"
          onClick={() => inputDigit('1')}
          className="rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          1
        </button>
        <button
          type="button"
          onClick={() => inputDigit('2')}
          className="rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          2
        </button>
        <button
          type="button"
          onClick={() => inputDigit('3')}
          className="rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          3
        </button>
        <button
          type="button"
          onClick={() => performOperation('+')}
          className="rounded-xl border border-indigo-500/30 bg-indigo-500/15 py-2.5 text-base font-bold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25 active:scale-95 transition-all cursor-pointer"
        >
          +
        </button>

        {/* Row 5 */}
        <button
          type="button"
          onClick={() => inputDigit('0')}
          className="col-span-2 rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          0
        </button>
        <button
          type="button"
          onClick={inputDecimal}
          className="rounded-xl border border-border/80 bg-muted/60 py-2.5 text-base font-bold text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          .
        </button>
        <button
          type="button"
          onClick={handleEquals}
          className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-2.5 text-lg font-bold text-white shadow-lg shadow-emerald-600/25 hover:from-emerald-500 hover:to-teal-500 active:scale-95 transition-all cursor-pointer"
        >
          =
        </button>
      </div>
    </div>
  )
}
