import * as React from "react"
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Strikethrough, Underline } from "lucide-react"

import { Input } from "@/components/ui/input"
import { NO_SHADOW, SHADOWS } from "./constants"
import { NumberBox, Row, Segmented, Toggle } from "./controls"
import type { Shadow, SizeMode, Vals } from "./types"
import { presetOf } from "./utils"

export function TextSection({
  text,
  onChangeText,
  canEditStyle,
  vals,
  onSet,
  onSetPx,
  n,
}: {
  text: string
  onChangeText: (v: string) => void
  canEditStyle: boolean
  vals: Vals
  onSet: (style: Record<string, string>) => void
  onSetPx: (key: string, n: number) => void
  n: (key: string) => number
}) {
  return (
    <div className="space-y-1">
      <Row label="Content">
        <Input value={text} placeholder="Text" aria-label="Text content" onChange={(e) => onChangeText(e.target.value)} className="h-9 w-[190px] text-sm" />
      </Row>
      {canEditStyle && (
        <>
          <Row label="Size">
            <NumberBox label="Font size" value={n("fontSize")} min={8} max={96} suffix="px" onChange={(v) => onSetPx("fontSize", v)} />
          </Row>
          <Row label="Weight">
            <Segmented
              label="Font weight"
              className="w-[190px]"
              value={Number(vals.fontWeight) >= 700 ? "700" : Number(vals.fontWeight) >= 600 ? "600" : Number(vals.fontWeight) >= 500 ? "500" : "400"}
              options={[{ value: "400", label: "Reg" }, { value: "500", label: "Med" }, { value: "600", label: "Semi" }, { value: "700", label: "Bold" }]}
              onChange={(v) => onSet({ fontWeight: v })}
            />
          </Row>
          <Row label="Line height">
            <NumberBox label="Line height" value={vals.lineHeight ? n("lineHeight") : null} placeholder="Auto" max={160} suffix="px" onChange={(v) => onSetPx("lineHeight", v)} />
          </Row>
          <Row label="Letter spacing">
            <NumberBox label="Letter spacing" value={n("letterSpacing")} min={-5} max={20} step={0.5} suffix="px" onChange={(v) => onSetPx("letterSpacing", v)} />
          </Row>
          <Row label="Align">
            <Segmented
              label="Text alignment"
              className="w-[190px]"
              value={vals.textAlign}
              options={[{ value: "left", icon: AlignLeft, title: "Left" }, { value: "center", icon: AlignCenter, title: "Center" }, { value: "right", icon: AlignRight, title: "Right" }]}
              onChange={(v) => onSet({ textAlign: v })}
            />
          </Row>
          <Row label="Style">
            <div className="flex items-center gap-0.5">
              <Toggle pressed={Number(vals.fontWeight) >= 600} label="Bold" icon={Bold} onClick={() => onSet({ fontWeight: Number(vals.fontWeight) >= 600 ? "400" : "700" })} />
              <Toggle pressed={vals.fontStyle === "italic"} label="Italic" icon={Italic} onClick={() => onSet({ fontStyle: vals.fontStyle === "italic" ? "normal" : "italic" })} />
              <Toggle pressed={vals.textDecorationLine === "underline"} label="Underline" icon={Underline} onClick={() => onSet({ textDecorationLine: vals.textDecorationLine === "underline" ? "none" : "underline" })} />
              <Toggle pressed={vals.textDecorationLine === "line-through"} label="Strikethrough" icon={Strikethrough} onClick={() => onSet({ textDecorationLine: vals.textDecorationLine === "line-through" ? "none" : "line-through" })} />
            </div>
          </Row>
        </>
      )}
    </div>
  )
}

export function ColorsSection({
  canEditText,
  colorRow,
}: {
  canEditText: boolean
  colorRow: (label: string, key: string, allowNone?: boolean) => React.ReactNode
}) {
  return (
    <div>
      {canEditText && colorRow("Text", "color")}
      {colorRow("Background", "backgroundColor", true)}
    </div>
  )
}

const SIDES = ["Top", "Right", "Bottom", "Left"] as const

export function SpacingSection({
  vals,
  n,
  onSetPx,
}: {
  vals: Vals
  n: (key: string) => number
  onSetPx: (key: string, n: number) => void
}) {
  return (
    <div>
      <Row label="Gap">
        <NumberBox label="Gap" value={vals.gap === "" ? null : n("gap")} placeholder="Auto" max={80} suffix={vals.gap === "" ? undefined : "px"} onChange={(v) => onSetPx("gap", v)} />
      </Row>
      {SIDES.map((s) => (
        <Row key={`p${s}`} label={`Padding ${s.toLowerCase()}`}>
          <NumberBox label={`Padding ${s.toLowerCase()}`} value={n(`padding${s}`)} max={200} onChange={(v) => onSetPx(`padding${s}`, v)} />
        </Row>
      ))}
      {SIDES.map((s) => (
        <Row key={`m${s}`} label={`Margin ${s.toLowerCase()}`}>
          <NumberBox label={`Margin ${s.toLowerCase()}`} value={n(`margin${s}`)} min={-200} max={200} onChange={(v) => onSetPx(`margin${s}`, v)} />
        </Row>
      ))}
    </div>
  )
}

export function LayoutSection({
  sizeMode,
  onSetSize,
  vals,
  n,
  onSetPx,
  onSet,
  isFlex,
}: {
  sizeMode: { width: SizeMode; height: SizeMode }
  onSetSize: (key: "width" | "height", mode: SizeMode) => void
  vals: Vals
  n: (key: string) => number
  onSetPx: (key: string, n: number) => void
  onSet: (style: Record<string, string>) => void
  isFlex: boolean
}) {
  const sizeRow = (label: string, key: "width" | "height") => (
    <div>
      <Row label={label}>
        <Segmented
          label={`${label} mode`}
          className="w-[190px]"
          value={sizeMode[key]}
          options={[{ value: "auto", label: "Auto" }, { value: "fill", label: "Fill" }, { value: "fixed", label: "Fixed" }]}
          onChange={(v) => onSetSize(key, v as SizeMode)}
        />
      </Row>
      {sizeMode[key] === "fixed" && (
        <Row label="">
          <NumberBox label={label} value={n(key)} min={1} max={2000} suffix="px" onChange={(v) => onSetPx(key, v)} />
        </Row>
      )}
    </div>
  )

  return (
    <div>
      {sizeRow("Width", "width")}
      {sizeRow("Height", "height")}
      <Row label="Fill space">
        <Segmented label="Grow to fill the free space" className="w-[190px]" value={vals.flexGrow === "1" ? "on" : "off"} options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} onChange={(v) => onSet({ flexGrow: v === "on" ? "1" : "0" })} />
      </Row>
      {isFlex ? (
        <>
          <Row label="Direction">
            <Segmented label="Direction" className="w-[190px]" value={vals.flexDirection} options={[{ value: "row", label: "Row" }, { value: "column", label: "Column" }]} onChange={(v) => onSet({ flexDirection: v })} />
          </Row>
          <Row label="Justify">
            <Segmented
              label="Justify content"
              className="w-[220px]"
              value={vals.justifyContent}
              options={[{ value: "flex-start", label: "Start" }, { value: "center", label: "Center" }, { value: "flex-end", label: "End" }, { value: "space-between", label: "Between" }]}
              onChange={(v) => onSet({ justifyContent: v })}
            />
          </Row>
          <Row label="Align">
            <Segmented
              label="Align items"
              className="w-[220px]"
              value={vals.alignItems}
              options={[{ value: "flex-start", label: "Start" }, { value: "center", label: "Center" }, { value: "flex-end", label: "End" }, { value: "stretch", label: "Stretch" }]}
              onChange={(v) => onSet({ alignItems: v })}
            />
          </Row>
          <Row label="Wrap">
            <Segmented label="Wrap" className="w-[190px]" value={vals.flexWrap} options={[{ value: "nowrap", label: "No wrap" }, { value: "wrap", label: "Wrap" }]} onChange={(v) => onSet({ flexWrap: v })} />
          </Row>
        </>
      ) : (
        <p className="py-1 text-xs text-muted-foreground">Direction and alignment apply to containers like rows and stacks.</p>
      )}
    </div>
  )
}

export function BorderSection({
  vals,
  n,
  onSet,
  onSetPx,
  colorRow,
  cornersEach,
  setCornersEach,
  onBorderWidthChange,
}: {
  vals: Vals
  n: (key: string) => number
  onSet: (style: Record<string, string>) => void
  onSetPx: (key: string, n: number) => void
  colorRow: (label: string, key: string, allowNone?: boolean) => React.ReactNode
  cornersEach: boolean
  setCornersEach: React.Dispatch<React.SetStateAction<boolean>>
  onBorderWidthChange: (v: number) => void
}) {
  return (
    <div>
      <Row label="Width">
        <NumberBox
          label="Border width"
          value={n("borderWidth")}
          max={16}
          suffix="px"
          onChange={onBorderWidthChange}
        />
      </Row>
      <Row label="Style">
        <Segmented label="Border style" className="w-[190px]" value={vals.borderStyle} options={[{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }]} onChange={(v) => onSet({ borderStyle: v })} />
      </Row>
      {colorRow("Color", "borderColor")}
      <Row label="Radius">
        <NumberBox
          label="Corner radius"
          value={cornersEach ? null : n("borderRadius")}
          placeholder="Mixed"
          max={200}
          suffix={cornersEach ? undefined : "px"}
          onChange={(v) => {
            setCornersEach(false)
            onSet({ borderRadius: `${v}px`, borderTopLeftRadius: `${v}px`, borderTopRightRadius: `${v}px`, borderBottomRightRadius: `${v}px`, borderBottomLeftRadius: `${v}px` })
          }}
        />
      </Row>
      <button type="button" onClick={() => setCornersEach((c) => !c)} className="mb-1 ml-auto block text-xs text-primary hover:underline">
        {cornersEach ? "Use one radius" : "Set each corner"}
      </button>
      {cornersEach &&
        (["TopLeft", "TopRight", "BottomRight", "BottomLeft"] as const).map((c) => (
          <Row key={c} label={`${c.replace(/([A-Z])/g, " $1").trim()}`}>
            <NumberBox label={`${c} radius`} value={n(`border${c}Radius`)} max={200} suffix="px" onChange={(v) => onSetPx(`border${c}Radius`, v)} />
          </Row>
        ))}
    </div>
  )
}

export function EffectsSection({
  vals,
  shadow,
  onSet,
  onApplyShadow,
}: {
  vals: Vals
  shadow: Shadow
  onSet: (style: Record<string, string>) => void
  onApplyShadow: (s: Shadow) => void
}) {
  return (
    <div>
      <Row label="Opacity">
        <div className="flex w-[190px] items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(Number(vals.opacity) * 100)}
            aria-label="Opacity"
            onChange={(e) => onSet({ opacity: String(Number(e.target.value) / 100) })}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
          />
          <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{Math.round(Number(vals.opacity) * 100)}%</span>
        </div>
      </Row>
      <Row label="Shadow">
        <Segmented
          label="Shadow"
          className="w-[220px]"
          value={presetOf(shadow)}
          options={[{ value: "none", label: "None" }, { value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]}
          onChange={(v) => onApplyShadow(v === "none" ? NO_SHADOW : SHADOWS[v])}
        />
      </Row>
      {shadow.opacity > 0 && (
        <>
          <Row label="Offset Y">
            <NumberBox label="Shadow offset" value={shadow.y} min={-40} max={40} suffix="px" onChange={(v) => onApplyShadow({ ...shadow, y: v })} />
          </Row>
          <Row label="Blur">
            <NumberBox label="Shadow blur" value={shadow.blur} max={60} suffix="px" onChange={(v) => onApplyShadow({ ...shadow, blur: v })} />
          </Row>
          <Row label="Strength">
            <NumberBox label="Shadow strength" value={Math.round(shadow.opacity * 100)} min={1} max={100} suffix="%" onChange={(v) => onApplyShadow({ ...shadow, opacity: v / 100 })} />
          </Row>
        </>
      )}
      <Row label="Overflow">
        <Segmented label="Overflow" className="w-[190px]" value={vals.overflow} options={[{ value: "visible", label: "Visible" }, { value: "hidden", label: "Clip" }]} onChange={(v) => onSet({ overflow: v })} />
      </Row>
    </div>
  )
}
