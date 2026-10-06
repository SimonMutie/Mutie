/**
 * Visuals that work on any data.
 *
 * Every visual is described the way Tableau and Power BI describe theirs: a
 * data source, the fields to group by (dimensions, placed on "rows" and
 * "columns") and the figures to work out for each group (measures, placed on
 * "values"), plus filters. From that description one request is compiled
 * (compileQuery) and sent to the server's analytics engine, whatever the
 * source's columns are.
 */

export type Agg = "count" | "distinct" | "sum" | "avg" | "min" | "max" | "median" | "q1" | "q3";
export type Grain = "year" | "quarter" | "month" | "week" | "day";
export type FieldType = "text" | "number" | "date";

export interface VizField {
  name: string;
  label: string;
  type: FieldType;
}

export interface VizDim {
  field: string;
  grain?: Grain;
  bin?: number;
}

export interface VizMeasure {
  /** Not needed for a plain count of rows. */
  field?: string;
  agg: Agg;
  /** A name chosen by the author, shown instead of "Sum of …". */
  label?: string;
}

export interface VizFilter {
  field: string;
  op: "in" | "not_in" | "gte" | "lte" | "contains";
  values: (string | number | null)[];
}

export interface VizQuery {
  dimensions: VizDim[];
  measures: VizMeasure[];
  filters?: VizFilter[];
  blanks?: "exclude" | "include";
  rollups?: number[][];
  limit?: number;
}

export interface VizRow {
  d: (string | number | null)[];
  m: (number | null)[];
}

export interface VizResult {
  rows: VizRow[];
  truncated: boolean;
  rollups?: { dims: number[]; rows: VizRow[] }[];
}

export type VizKind =
  // tables
  | "pivot"
  | "rank"
  | "trends"
  // compare
  | "bar"
  | "lollipop"
  | "dumbbell"
  | "butterfly"
  | "bullet"
  | "pareto"
  | "marimekko"
  | "radar"
  | "heatmap"
  | "slope"
  // over time
  | "line"
  | "area"
  | "stream"
  | "bump"
  | "multiples"
  | "combo"
  | "calendar"
  | "race"
  | "waterfall"
  // parts of a whole
  | "donut"
  | "pie"
  | "rose"
  | "radialbar"
  | "treemap"
  | "sunburst"
  | "funnel"
  | "waffle"
  | "progress"
  // spread and relationship
  | "scatter"
  | "histogram"
  | "boxplot"
  // flow and links
  | "sankey"
  | "chord"
  | "network"
  // maps
  | "choropleth"
  | "symbolmap"
  | "tilemap"
  | "dotmap"
  | "globe"
  // single figures
  | "kpi"
  | "figures"
  | "gauge"
  | "ring"
  // infographic
  | "pictogram"
  | "parliament"
  | "bubbles"
  | "wordcloud"
  // controls and text
  | "slicer"
  | "text";

/** How a visual is drawn. Never read by the server. */
export interface VizOptions {
  /** Bars: "auto" lays long or many labels out horizontally. */
  orientation?: "auto" | "vertical" | "horizontal";
  /** Bars and areas with several series. */
  stack?: "grouped" | "stacked" | "percent";
  /** Keep only the largest N categories (0 keeps them all). */
  topN?: number;
  /** Write the value on each mark. */
  labels?: boolean;
  /** Lines: curved rather than straight segments. */
  smooth?: boolean;
  /** Pivot table cells: shaded by value, with a bar, or plain. */
  shading?: "heat" | "bars" | "none";
  totals?: boolean;
  subtotals?: boolean;
  /** Gauge and KPI: the figure to reach. */
  target?: number;
  /** Gauge: the top of the dial when there is no target. */
  max?: number;
  /** Maps: which part of the world is drawn. "auto" frames Africa when every place named is African. */
  scope?: "auto" | "africa" | "world";
  /** Dot map: the size of a cell, in degrees. */
  cell?: number;
  /** Lines and the bar race: each period shows the total so far rather than its own figure. */
  cumulative?: boolean;
  /** Lines: flat steps between points rather than slopes. */
  step?: boolean;
  /** Text card. */
  heading?: string;
  text?: string;
  align?: "left" | "center";
  /** Number formatting. */
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** For a figure where a fall is good news (deaths, incidents): colours a fall as an improvement. */
  lowerIsBetter?: boolean;
  /** Labels and types of the fields this visual uses, kept with it so a shared dashboard can label them without the field list. */
  fields?: Record<string, { label: string; type: FieldType }>;
}

export interface VizSpec {
  kind: VizKind;
  /** "incidents" or "dataset:<id>"; empty for a text card. */
  source: string;
  rows: VizDim[];
  columns: VizDim[];
  values: VizMeasure[];
  filters: VizFilter[];
  /** The compiled request, saved so a shared dashboard runs exactly this. */
  query?: VizQuery;
  options?: VizOptions;
}

// ── The kinds of visual ──────────────────────────────────────────────────

export interface WellMeta {
  /** What this well is called for this visual ("Axis", "Slices"…). */
  label: string;
  hint: string;
  min: number;
  max: number;
  /** Field types that make sense here; any when omitted. */
  types?: FieldType[];
}

export type KindGroup = "Tables" | "Compare" | "Over time" | "Parts of a whole" | "Spread and relationship" | "Flow and links" | "Maps" | "Single figures" | "Infographic" | "Controls and text";
export const KIND_GROUPS: KindGroup[] = [
  "Compare",
  "Over time",
  "Parts of a whole",
  "Spread and relationship",
  "Flow and links",
  "Maps",
  "Infographic",
  "Single figures",
  "Tables",
  "Controls and text",
];

export interface KindMeta {
  key: VizKind;
  label: string;
  /** One line on what it is good for. */
  blurb: string;
  group: KindGroup;
  rows?: WellMeta;
  columns?: WellMeta;
  values?: WellMeta;
  /** A starting size on the 12-column grid. */
  size: { w: number; h: number };
}

const one = (label: string, hint: string, types?: FieldType[]): WellMeta => ({ label, hint, min: 1, max: 1, types });
const optional = (label: string, hint: string, types?: FieldType[]): WellMeta => ({ label, hint, min: 0, max: 1, types });

export const KINDS: KindMeta[] = [
  {
    key: "pivot",
    label: "Pivot table",
    blurb: "Cross any fields against each other, with subtotals and totals.",
    group: "Tables",
    rows: { label: "Rows", hint: "Fields listed down the side", min: 0, max: 3 },
    columns: { label: "Columns", hint: "Fields spread across the top", min: 0, max: 2 },
    values: { label: "Values", hint: "Figures in the cells", min: 0, max: 6 },
    size: { w: 12, h: 12 },
  },
  {
    key: "rank",
    label: "Leaderboard",
    blurb: "A ranked list with a bar behind each figure.",
    group: "Tables",
    rows: one("Items", "What is being ranked"),
    values: { label: "Ranked by", hint: "The figure to rank on (a second is shown beside it)", min: 0, max: 2 },
    size: { w: 4, h: 10 },
  },
  {
    key: "bar",
    label: "Bar chart",
    blurb: "Compare categories. Split by a second field to group or stack.",
    group: "Compare",
    rows: one("Axis", "One bar per value of this field"),
    columns: optional("Split by", "A colour per value of this field"),
    values: { label: "Values", hint: "How long each bar is", min: 0, max: 4 },
    size: { w: 6, h: 9 },
  },
  {
    key: "heatmap",
    label: "Heat grid",
    blurb: "Two fields crossed, each cell shaded by its figure.",
    group: "Compare",
    rows: one("Rows", "Down the side"),
    columns: one("Columns", "Across the top"),
    values: { label: "Shade by", hint: "The figure behind the colour", min: 0, max: 1 },
    size: { w: 6, h: 10 },
  },
  {
    key: "slope",
    label: "Slope chart",
    blurb: "Who rose and who fell between two points.",
    group: "Compare",
    rows: one("Lines", "One line per value of this field"),
    columns: one("From and to", "The first and last value of this field are compared (often a year)"),
    values: { label: "Value", hint: "The figure compared", min: 0, max: 1 },
    size: { w: 5, h: 10 },
  },
  {
    key: "line",
    label: "Line chart",
    blurb: "How a figure moves over time.",
    group: "Over time",
    rows: one("Axis", "Usually a date"),
    columns: optional("Split by", "A line per value of this field"),
    values: { label: "Values", hint: "The figure drawn", min: 0, max: 4 },
    size: { w: 8, h: 9 },
  },
  {
    key: "area",
    label: "Area chart",
    blurb: "A total over time and what it is made of.",
    group: "Over time",
    rows: one("Axis", "Usually a date"),
    columns: optional("Split by", "A band per value of this field"),
    values: { label: "Values", hint: "The figure drawn", min: 0, max: 4 },
    size: { w: 8, h: 9 },
  },
  {
    key: "waterfall",
    label: "Waterfall",
    blurb: "How each step adds up to the total.",
    group: "Over time",
    rows: one("Steps", "One step per value of this field"),
    values: { label: "Amount", hint: "What each step adds", min: 0, max: 1 },
    size: { w: 7, h: 9 },
  },
  {
    key: "donut",
    label: "Donut",
    blurb: "Shares of a whole, for a handful of parts.",
    group: "Parts of a whole",
    rows: one("Slices", "One slice per value of this field"),
    values: { label: "Size", hint: "How big each slice is", min: 0, max: 1 },
    size: { w: 4, h: 9 },
  },
  {
    key: "treemap",
    label: "Treemap",
    blurb: "Shares of a whole when there are many parts, nested if you like.",
    group: "Parts of a whole",
    rows: { label: "Groups", hint: "One box per value; add a second field to nest", min: 1, max: 2 },
    values: { label: "Size", hint: "How big each box is", min: 0, max: 1 },
    size: { w: 6, h: 10 },
  },
  {
    key: "waffle",
    label: "Waffle",
    blurb: "A hundred squares: one per percent. Shares people can count.",
    group: "Parts of a whole",
    rows: one("Parts", "One colour per value of this field"),
    values: { label: "Size", hint: "What the shares are of", min: 0, max: 1 },
    size: { w: 4, h: 10 },
  },
  {
    key: "scatter",
    label: "Scatter and bubble",
    blurb: "Whether two figures move together. A third sets the bubble size.",
    group: "Spread and relationship",
    rows: one("One dot per", "Each value of this field becomes a dot"),
    columns: optional("Colour by", "A colour per value of this field"),
    values: { label: "Across, up, size", hint: "First figure across, second up, optional third as size", min: 2, max: 3 },
    size: { w: 6, h: 10 },
  },
  {
    key: "histogram",
    label: "Histogram",
    blurb: "How a number is spread: where most values fall.",
    group: "Spread and relationship",
    rows: one("Number", "The number whose spread is shown", ["number"]),
    size: { w: 6, h: 9 },
  },
  {
    key: "kpi",
    label: "Headline figure",
    blurb: "One big number, its trend, and the change on the period before.",
    group: "Single figures",
    rows: optional("Trend over", "A date, for the trend line and the change", ["date"]),
    values: { label: "Figure", hint: "The number shown", min: 0, max: 1 },
    size: { w: 3, h: 6 },
  },
  {
    key: "gauge",
    label: "Gauge",
    blurb: "A figure against a target.",
    group: "Single figures",
    values: { label: "Figure", hint: "The number shown", min: 0, max: 1 },
    size: { w: 3, h: 7 },
  },
  {
    key: "slicer",
    label: "Slicer",
    blurb: "A control that filters the other visuals on the same data.",
    group: "Controls and text",
    rows: one("Field", "The field viewers filter by"),
    size: { w: 3, h: 7 },
  },
  {
    key: "text",
    label: "Text card",
    blurb: "A heading and a few lines of your own.",
    group: "Controls and text",
    size: { w: 4, h: 4 },
  },
  // ── Added: the families Tableau, Flourish and Power BI offer, and every kind the older widgets had ──
  {
    key: "trends",
    label: "Trend table",
    blurb: "One row per item: its trend line, latest figure and change.",
    group: "Tables",
    rows: one("Trend over", "Usually a date", ["date"]),
    columns: one("One row per", "Each value gets a row with its own trend line"),
    values: { label: "Value", hint: "The figure tracked", min: 0, max: 1 },
    size: { w: 5, h: 10 },
  },
  {
    key: "lollipop",
    label: "Lollipop",
    blurb: "A lighter bar chart: a dot on a stem. Good for long ranked lists.",
    group: "Compare",
    rows: one("Items", "One stem per value of this field"),
    values: { label: "Value", hint: "How far each dot sits", min: 0, max: 1 },
    size: { w: 5, h: 10 },
  },
  {
    key: "dumbbell",
    label: "Dumbbell",
    blurb: "The gap between two groups, item by item.",
    group: "Compare",
    rows: one("Items", "One row per value of this field"),
    columns: one("Two groups", "The first and last value of this field are compared (two years, two actors)"),
    values: { label: "Value", hint: "The figure compared", min: 0, max: 1 },
    size: { w: 6, h: 10 },
  },
  {
    key: "butterfly",
    label: "Butterfly",
    blurb: "Two groups back to back: the population-pyramid layout.",
    group: "Compare",
    rows: one("Bands", "One pair of bars per value of this field"),
    columns: one("Two sides", "The two values of this field face each other"),
    values: { label: "Value", hint: "How long each bar is", min: 0, max: 1 },
    size: { w: 6, h: 10 },
  },
  {
    key: "bullet",
    label: "Bullet",
    blurb: "A figure against a target, for one item or a list of them.",
    group: "Compare",
    rows: optional("One bar per", "Leave empty for a single bar"),
    values: { label: "Figure, then target", hint: "The second figure, if added, is the mark to reach (or set a target below)", min: 0, max: 2 },
    size: { w: 5, h: 7 },
  },
  {
    key: "pareto",
    label: "Pareto",
    blurb: "Which few items make up most of the total.",
    group: "Compare",
    rows: one("Items", "One bar per value of this field"),
    values: { label: "Value", hint: "What is being added up", min: 0, max: 1 },
    size: { w: 7, h: 9 },
  },
  {
    key: "marimekko",
    label: "Marimekko",
    blurb: "Columns as wide as their total, each split into shares.",
    group: "Compare",
    rows: one("Columns", "One column per value, as wide as its total"),
    columns: one("Split by", "The shares inside each column"),
    values: { label: "Value", hint: "The figure behind the sizes", min: 0, max: 1 },
    size: { w: 7, h: 10 },
  },
  {
    key: "radar",
    label: "Radar",
    blurb: "A profile across several spokes, one shape per group.",
    group: "Compare",
    rows: one("Spokes", "One spoke per value of this field"),
    columns: optional("One shape per", "A shape for each value of this field"),
    values: { label: "Values", hint: "How far out each point sits", min: 0, max: 4 },
    size: { w: 5, h: 10 },
  },
  {
    key: "stream",
    label: "Streamgraph",
    blurb: "How the mix swells and thins over time.",
    group: "Over time",
    rows: one("Axis", "Usually a date"),
    columns: one("Split by", "A band per value of this field"),
    values: { label: "Value", hint: "The thickness of each band", min: 0, max: 1 },
    size: { w: 8, h: 9 },
  },
  {
    key: "bump",
    label: "Bump chart",
    blurb: "Who ranked where, period by period.",
    group: "Over time",
    rows: one("Axis", "Usually a date"),
    columns: one("Ranked", "A line per value of this field"),
    values: { label: "Ranked by", hint: "The figure that sets the order", min: 0, max: 1 },
    size: { w: 8, h: 9 },
  },
  {
    key: "multiples",
    label: "Small multiples",
    blurb: "The same small chart repeated, one per group, on one scale.",
    group: "Over time",
    rows: one("Axis", "Usually a date"),
    columns: one("One chart per", "Each value of this field gets its own small chart"),
    values: { label: "Value", hint: "The figure drawn", min: 0, max: 1 },
    size: { w: 8, h: 10 },
  },
  {
    key: "combo",
    label: "Bars and line",
    blurb: "Two figures over the same axis, each on its own panel so neither scale misleads.",
    group: "Over time",
    rows: one("Axis", "Usually a date"),
    values: { label: "Bars, then line", hint: "The first figure is drawn as bars, the second as a line", min: 2, max: 2 },
    size: { w: 8, h: 10 },
  },
  {
    key: "calendar",
    label: "Calendar",
    blurb: "Every day as a square, shaded by its figure.",
    group: "Over time",
    rows: one("Date", "The date each row belongs to", ["date"]),
    values: { label: "Shade by", hint: "The figure behind the colour", min: 0, max: 1 },
    size: { w: 8, h: 7 },
  },
  {
    key: "race",
    label: "Bar race",
    blurb: "Ranked bars that play through time.",
    group: "Over time",
    rows: one("Plays through", "Usually a date", ["date"]),
    columns: one("Bars", "One bar per value of this field"),
    values: { label: "Value", hint: "How long each bar is", min: 0, max: 1 },
    size: { w: 6, h: 11 },
  },
  {
    key: "pie",
    label: "Pie",
    blurb: "Shares of a whole, for two to five parts.",
    group: "Parts of a whole",
    rows: one("Slices", "One slice per value of this field"),
    values: { label: "Size", hint: "How big each slice is", min: 0, max: 1 },
    size: { w: 4, h: 9 },
  },
  {
    key: "rose",
    label: "Rose",
    blurb: "Equal slices that reach further for bigger figures.",
    group: "Parts of a whole",
    rows: one("Petals", "One petal per value of this field"),
    values: { label: "Size", hint: "How far each petal reaches", min: 0, max: 1 },
    size: { w: 4, h: 10 },
  },
  {
    key: "radialbar",
    label: "Radial bars",
    blurb: "Bars bent round a circle. Striking; use for a short list.",
    group: "Parts of a whole",
    rows: one("Rings", "One ring per value of this field"),
    values: { label: "Length", hint: "How far round each ring goes", min: 0, max: 1 },
    size: { w: 4, h: 10 },
  },
  {
    key: "sunburst",
    label: "Sunburst",
    blurb: "A whole split into groups, and each group into its members.",
    group: "Parts of a whole",
    rows: { label: "Rings", hint: "The inner ring, then the outer one", min: 1, max: 2 },
    values: { label: "Size", hint: "How big each arc is", min: 0, max: 1 },
    size: { w: 5, h: 10 },
  },
  {
    key: "funnel",
    label: "Funnel",
    blurb: "Stages that narrow, with what is kept at each step.",
    group: "Parts of a whole",
    rows: one("Stages", "One stage per value of this field"),
    values: { label: "Size", hint: "How wide each stage is", min: 0, max: 1 },
    size: { w: 5, h: 9 },
  },
  {
    key: "progress",
    label: "Progress bars",
    blurb: "Each item as a bar towards a target, or as its share of the total.",
    group: "Parts of a whole",
    rows: one("Items", "One bar per value of this field"),
    values: { label: "Value", hint: "How full each bar is", min: 0, max: 1 },
    size: { w: 4, h: 9 },
  },
  {
    key: "boxplot",
    label: "Box plot",
    blurb: "The middle half, the median and the extremes of a number, group by group.",
    group: "Spread and relationship",
    rows: optional("One box per", "Leave empty for a single box"),
    values: { label: "Number", hint: "The number whose spread is shown", min: 1, max: 1, types: ["number"] },
    size: { w: 6, h: 9 },
  },
  {
    key: "sankey",
    label: "Sankey",
    blurb: "What flows from where to where, and how much.",
    group: "Flow and links",
    rows: { label: "From", hint: "Where a flow starts (add a second field for a stage in between)", min: 1, max: 2 },
    columns: one("To", "Where it ends"),
    values: { label: "Size", hint: "How thick each flow is", min: 0, max: 1 },
    size: { w: 7, h: 10 },
  },
  {
    key: "chord",
    label: "Chord",
    blurb: "Who is tied to whom, round a circle.",
    group: "Flow and links",
    rows: one("From", "One end of each tie"),
    columns: one("To", "The other end"),
    values: { label: "Size", hint: "How thick each tie is", min: 0, max: 1 },
    size: { w: 5, h: 11 },
  },
  {
    key: "network",
    label: "Network",
    blurb: "Things as dots, their ties as lines.",
    group: "Flow and links",
    rows: one("From", "One end of each tie"),
    columns: one("To", "The other end"),
    values: { label: "Strength", hint: "How heavy each line is", min: 0, max: 1 },
    size: { w: 6, h: 11 },
  },
  {
    key: "choropleth",
    label: "Choropleth",
    blurb: "Countries shaded by their figure.",
    group: "Maps",
    rows: one("Country", "A field holding country names", ["text"]),
    values: { label: "Shade by", hint: "The figure behind the colour", min: 0, max: 1 },
    size: { w: 6, h: 12 },
  },
  {
    key: "symbolmap",
    label: "Symbol map",
    blurb: "A circle on each country, sized by its figure.",
    group: "Maps",
    rows: one("Country", "A field holding country names", ["text"]),
    values: { label: "Size", hint: "How big each circle is", min: 0, max: 1 },
    size: { w: 6, h: 12 },
  },
  {
    key: "tilemap",
    label: "Africa tile map",
    blurb: "Every African country as an equal square, so small states are not lost.",
    group: "Maps",
    rows: one("Country", "A field holding country names", ["text"]),
    values: { label: "Shade by", hint: "The figure behind the colour", min: 0, max: 1 },
    size: { w: 5, h: 12 },
  },
  {
    key: "dotmap",
    label: "Dot map",
    blurb: "Rows placed by their latitude and longitude, gathered into dots.",
    group: "Maps",
    rows: { label: "Latitude, then longitude", hint: "Two number fields: latitude first, longitude second", min: 2, max: 2, types: ["number"] },
    values: { label: "Size", hint: "How big each dot is", min: 0, max: 1 },
    size: { w: 6, h: 12 },
  },
  {
    key: "globe",
    label: "3D globe",
    blurb: "Countries lit on a turning globe.",
    group: "Maps",
    rows: one("Country", "A field holding country names", ["text"]),
    values: { label: "Shade by", hint: "The figure behind the colour", min: 0, max: 1 },
    size: { w: 6, h: 13 },
  },
  {
    key: "figures",
    label: "Row of figures",
    blurb: "Several headline numbers side by side.",
    group: "Single figures",
    values: { label: "Figures", hint: "Up to six numbers", min: 1, max: 6 },
    size: { w: 8, h: 4 },
  },
  {
    key: "ring",
    label: "Progress ring",
    blurb: "How far a figure has got towards a target.",
    group: "Single figures",
    values: { label: "Figure", hint: "The number shown", min: 0, max: 1 },
    size: { w: 3, h: 7 },
  },
  {
    key: "pictogram",
    label: "Pictogram",
    blurb: "People-shaped counters: one figure for every so many.",
    group: "Infographic",
    rows: one("Groups", "One colour per value of this field"),
    values: { label: "Count", hint: "What the figures stand for", min: 0, max: 1 },
    size: { w: 5, h: 9 },
  },
  {
    key: "parliament",
    label: "Hemicycle",
    blurb: "Dots in a half circle, like seats in a chamber.",
    group: "Infographic",
    rows: one("Groups", "One colour per value of this field"),
    values: { label: "Size", hint: "How many dots each group gets", min: 0, max: 1 },
    size: { w: 5, h: 9 },
  },
  {
    key: "bubbles",
    label: "Packed bubbles",
    blurb: "A cluster of circles, the big ones standing out.",
    group: "Infographic",
    rows: one("Bubbles", "One bubble per value of this field"),
    columns: optional("Colour by", "A colour per value of this field"),
    values: { label: "Size", hint: "How big each bubble is", min: 0, max: 1 },
    size: { w: 5, h: 10 },
  },
  {
    key: "wordcloud",
    label: "Word cloud",
    blurb: "Names sized by their figure. For impression, not for reading off values.",
    group: "Infographic",
    rows: one("Words", "One word per value of this field"),
    values: { label: "Size", hint: "How big each word is", min: 0, max: 1 },
    size: { w: 5, h: 9 },
  },
];

export const KIND: Record<VizKind, KindMeta> = Object.fromEntries(KINDS.map((k) => [k.key, k])) as Record<VizKind, KindMeta>;

export const AGG_LABEL: Record<Agg, string> = {
  count: "Count",
  distinct: "Distinct count",
  sum: "Sum",
  avg: "Average",
  min: "Smallest",
  max: "Largest",
  median: "Median",
  q1: "Lower quartile",
  q3: "Upper quartile",
};
export const GRAIN_LABEL: Record<Grain, string> = { year: "Year", quarter: "Quarter", month: "Month", week: "Week", day: "Day" };

/** Adding these up across groups gives the right total; averages and distinct counts do not. */
export const isAdditive = (m: VizMeasure | undefined) => !m || m.agg === "count" || m.agg === "sum";

/** The measure a visual uses when none has been chosen: a count of rows. */
export const COUNT: VizMeasure = { agg: "count" };
export const valuesOf = (v: VizSpec): VizMeasure[] => (v.values.length ? v.values : [COUNT]);

/** The figures a visual's request actually asks for (a box plot asks for six of one field). */
export function measuresOf(v: VizSpec): VizMeasure[] {
  return compileQuery(v)?.measures ?? valuesOf(v);
}

export function fieldInfo(v: VizSpec, name: string | undefined, fields?: VizField[]): VizField {
  const known = name ? (fields?.find((f) => f.name === name) ?? (v.options?.fields?.[name] ? { name, ...v.options.fields[name] } : undefined)) : undefined;
  return known ?? { name: name ?? "", label: name ?? "", type: "text" };
}

/** What a measure is called on screen. */
export function measureLabel(v: VizSpec, m: VizMeasure, fields?: VizField[]): string {
  if (m.label) return m.label;
  if (!m.field) return v.source === "incidents" ? "Incidents" : "Rows";
  const f = fieldInfo(v, m.field, fields).label;
  switch (m.agg) {
    case "sum":
      return f;
    case "avg":
      return `Average ${lowerFirst(f)}`;
    case "min":
      return `Smallest ${lowerFirst(f)}`;
    case "max":
      return `Largest ${lowerFirst(f)}`;
    case "distinct":
      return `Different ${lowerFirst(f)} values`;
    case "median":
      return `Median ${lowerFirst(f)}`;
    case "q1":
      return `Lower quartile of ${lowerFirst(f)}`;
    case "q3":
      return `Upper quartile of ${lowerFirst(f)}`;
    default:
      return `Rows with ${lowerFirst(f)}`;
  }
}
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

export function dimTitle(v: VizSpec, d: VizDim, fields?: VizField[]): string {
  const f = fieldInfo(v, d.field, fields).label;
  return d.grain ? `${f} (${GRAIN_LABEL[d.grain].toLowerCase()})` : f;
}

// ── From a visual to a request ───────────────────────────────────────────

/** Why a visual cannot be drawn yet, in words for the builder; null when it can. */
export function missing(v: VizSpec): string | null {
  const meta = KIND[v.kind];
  if (!meta) return "This kind of visual is not known to this version of the site.";
  if (v.kind === "text") return null;
  if (!v.source) return "Choose the data to use.";
  const need = (well: WellMeta | undefined, have: number) => (well && have < well.min ? `Add ${well.min - have > 1 ? `${well.min - have} fields` : "a field"} to “${well.label}”.` : null);
  if (v.kind === "pivot" && v.rows.length + v.columns.length === 0) return "Add a field to “Rows” or “Columns”.";
  return need(meta.rows, v.rows.length) ?? need(meta.columns, v.columns.length) ?? need(meta.values, v.values.length);
}

/**
 * The request a visual makes. Null while the visual is incomplete (see
 * `missing`) or needs no data.
 */
export function compileQuery(v: VizSpec): VizQuery | null {
  if (v.kind === "text" || missing(v)) return null;
  const meta = KIND[v.kind];
  const rows = v.rows.slice(0, meta.rows?.max ?? 0);
  const columns = v.columns.slice(0, meta.columns?.max ?? 0);
  const measures = valuesOf(v).slice(0, Math.max(meta.values?.max ?? 1, 1));
  const filters = v.filters.filter((f) => f.values.length > 0).slice(0, 8);
  const base = { filters: filters.length ? filters : undefined };

  switch (v.kind) {
    case "pivot": {
      const R = rows.length;
      const C = Math.min(columns.length, 4 - R);
      const dims = [...rows, ...columns.slice(0, C)];
      const rowIdx = rows.map((_, i) => i);
      const colIdx = Array.from({ length: C }, (_, i) => R + i);
      // Totals are asked of the server rather than added up here, so that an
      // average or a distinct count is right in the total rows too.
      const rollups: number[][] = [[]];
      if (C > 0 && R > 0) rollups.push(rowIdx, colIdx);
      if (R >= 2) {
        rollups.push([0]);
        if (C > 0) rollups.push([0, ...colIdx]);
      }
      return { ...base, dimensions: dims, measures, blanks: "include", rollups, limit: 5000 };
    }
    case "kpi":
      // The trend by period, plus the overall figure. (Rows with no date are kept as a group of their own, so the
      // server can work the overall figure out from this one pass over the data instead of reading it twice.)
      return rows.length
        ? { ...base, dimensions: [{ field: rows[0].field, grain: rows[0].grain ?? "month" }], measures: [measures[0]], blanks: "include", rollups: [[]], limit: 400 }
        : { ...base, dimensions: [], measures: [measures[0]] };
    case "gauge":
      return { ...base, dimensions: [], measures: [measures[0]] };
    case "slicer":
      return { ...base, dimensions: [rows[0]], measures: [COUNT], blanks: "include", limit: 200 };
    case "histogram":
      return { ...base, dimensions: [{ field: rows[0].field, bin: rows[0].bin ?? 1 }], measures: [COUNT], limit: 400 };
    case "scatter":
      return { ...base, dimensions: [rows[0], ...columns], measures, limit: 1500 };
    case "treemap":
      return { ...base, dimensions: rows, measures: [measures[0]], limit: 600 };
    case "heatmap":
    case "slope":
      return { ...base, dimensions: [rows[0], columns[0]], measures: [measures[0]], limit: 3000 };
    case "sunburst":
      return { ...base, dimensions: rows, measures: [measures[0]], limit: 600 };
    case "dumbbell":
    case "butterfly":
    case "marimekko":
    case "chord":
    case "network":
      return { ...base, dimensions: [rows[0], columns[0]], measures: [measures[0]], limit: 3000 };
    case "sankey":
      return { ...base, dimensions: [...rows, columns[0]], measures: [measures[0]], limit: 3000 };
    case "bubbles":
      return { ...base, dimensions: [rows[0], ...columns], measures: [measures[0]], limit: 400 };
    case "donut":
    case "waffle":
    case "waterfall":
    case "lollipop":
    case "pareto":
    case "pie":
    case "rose":
    case "radialbar":
    case "funnel":
    case "progress":
    case "pictogram":
    case "parliament":
    case "wordcloud":
    case "choropleth":
    case "symbolmap":
    case "tilemap":
    case "globe":
      return { ...base, dimensions: [rows[0]], measures: [measures[0]], limit: 1000 };
    case "rank":
      return { ...base, dimensions: [rows[0]], measures, limit: 500 };
    case "bullet":
      return { ...base, dimensions: rows.slice(0, 1), measures: measures.slice(0, 2), limit: 60 };
    case "combo":
      return { ...base, dimensions: [rows[0]], measures: measures.slice(0, 2), limit: 2000 };
    case "figures":
      return { ...base, dimensions: [], measures };
    case "ring":
      return { ...base, dimensions: [], measures: [measures[0]] };
    case "calendar":
      return { ...base, dimensions: [{ field: rows[0].field, grain: "day" }], measures: [measures[0]], limit: 1200 };
    case "boxplot": {
      // The five numbers a box is drawn from, and how many values stand behind it.
      const field = measures[0].field;
      const five: VizMeasure[] = (["min", "q1", "median", "q3", "max", "count"] as Agg[]).map((agg) => ({ field, agg }));
      return { ...base, dimensions: rows.slice(0, 1), measures: five, limit: 60 };
    }
    case "dotmap": {
      // Rows are gathered into cells of a fraction of a degree; each cell is one dot.
      const cell = v.options?.cell && v.options.cell > 0 ? v.options.cell : 0.5;
      return {
        ...base,
        dimensions: [
          { field: rows[0].field, bin: cell },
          { field: rows[1].field, bin: cell },
        ],
        measures: [measures[0]],
        limit: 4000,
      };
    }
    default:
      // bar, line, area: with a split field the first value is drawn per split; without, each value is a series.
      return columns.length ? { ...base, dimensions: [rows[0], columns[0]], measures: [measures[0]], limit: 4000 } : { ...base, dimensions: [rows[0]], measures, limit: 2000 };
  }
}

/** A visual with its compiled request and the labels of its fields attached, ready to save. */
export function finalize(v: VizSpec, fields: VizField[]): VizSpec {
  const used = new Set<string>();
  for (const d of [...v.rows, ...v.columns]) used.add(d.field);
  for (const m of v.values) if (m.field) used.add(m.field);
  for (const f of v.filters) used.add(f.field);
  const labels: Record<string, { label: string; type: FieldType }> = {};
  for (const name of used) {
    const f = fields.find((x) => x.name === name) ?? (v.options?.fields?.[name] ? { name, ...v.options.fields[name] } : null);
    if (f) labels[name] = { label: f.label, type: f.type };
  }
  const next: VizSpec = { ...v, options: { ...v.options, fields: labels } };
  const query = compileQuery(next);
  return { ...next, query: query ?? undefined };
}

// ── Suggestions ──────────────────────────────────────────────────────────

/**
 * Which visuals suit the fields chosen so far — the idea behind Tableau's
 * "Show Me": the first is the best fit, the rest are reasonable.
 */
export function recommend(v: VizSpec, fields: VizField[]): VizKind[] {
  const type = (d: VizDim | undefined) => (d ? (fields.find((f) => f.name === d.field)?.type ?? "text") : null);
  const dims = [...v.rows, ...v.columns];
  const first = type(dims[0]);
  const second = type(dims[1]);
  const nValues = v.values.length;
  if (dims.length === 0) return nValues > 1 ? ["figures", "kpi"] : nValues > 0 ? ["kpi", "gauge", "ring"] : [];
  const placeLike = (d: VizDim | undefined) => !!d && /countr|nation|state\b/i.test(fields.find((f) => f.name === d.field)?.label ?? d.field);
  if (dims.length === 1) {
    if (first === "date") return nValues >= 2 ? ["combo", "line", "bar", "area"] : ["line", "area", "bar", "calendar", "kpi", "waterfall"];
    if (first === "number" && nValues === 0) return ["histogram", "bar"];
    if (nValues >= 2) return ["scatter", "bar", "rank", "radar", "bullet", "pivot"];
    if (placeLike(dims[0])) return ["bar", "choropleth", "symbolmap", "tilemap", "rank", "treemap", "globe"];
    return ["bar", "rank", "lollipop", "donut", "treemap", "pareto", "funnel", "bubbles", "pictogram"];
  }
  if (dims.length === 2) {
    if (first === "number" && second === "number") return ["dotmap", "heatmap"];
    if (first === "date" || second === "date") return ["line", "area", "bar", "stream", "bump", "multiples", "trends", "race", "slope", "pivot"];
    return ["bar", "heatmap", "sankey", "pivot", "marimekko", "treemap", "sunburst", "chord", "dumbbell"];
  }
  return ["pivot"];
}

/**
 * Moves the chosen fields into the wells a different kind of visual has, so
 * switching kind keeps as much of the work as possible.
 */
export function adaptTo(v: VizSpec, kind: VizKind, fields: VizField[]): VizSpec {
  const meta = KIND[kind];
  const typeOf = (d: VizDim) => fields.find((f) => f.name === d.field)?.type ?? v.options?.fields?.[d.field]?.type ?? "text";
  const fits = (well: WellMeta | undefined, d: VizDim) => !!well && (!well.types || well.types.includes(typeOf(d)));
  // Fields stay on the well they are on where the new kind has that well and room on it; the rest go wherever they fit.
  const rows: VizDim[] = [];
  const columns: VizDim[] = [];
  const spare: VizDim[] = [];
  for (const d of v.rows) (fits(meta.rows, d) && rows.length < (meta.rows?.max ?? 0) ? rows : spare).push(d);
  for (const d of v.columns) (fits(meta.columns, d) && columns.length < (meta.columns?.max ?? 0) ? columns : spare).push(d);
  for (const d of spare) {
    if (fits(meta.rows, d) && rows.length < (meta.rows?.max ?? 0)) rows.push(d);
    else if (fits(meta.columns, d) && columns.length < (meta.columns?.max ?? 0)) columns.push(d);
  }
  // A line or a slope wants its date in a particular well.
  const timeOnRows: VizKind[] = ["line", "area", "stream", "bump", "multiples", "trends", "race"];
  if (timeOnRows.includes(kind) && columns.length && typeOf(columns[0]) === "date" && (!rows.length || typeOf(rows[0]) !== "date")) {
    // The date goes on the axis; whatever was there becomes the split.
    const date = columns[0];
    if (rows.length) columns[0] = rows[0];
    else columns.length = 0;
    rows[0] = date;
  }
  if (kind === "slope" && rows.length && columns.length && typeOf(rows[0]) === "date" && typeOf(columns[0]) !== "date") [rows[0], columns[0]] = [columns[0], rows[0]];
  const tidy = (d: VizDim): VizDim => {
    const t = typeOf(d);
    if (kind === "histogram") return { field: d.field, bin: d.bin };
    if (kind === "dotmap" || kind === "slicer") return { field: d.field };
    if (t === "date") return { field: d.field, grain: d.grain ?? "month" };
    return { field: d.field };
  };
  const values = v.values.slice(0, meta.values?.max ?? 0);
  return { ...v, kind, rows: rows.map(tidy), columns: columns.map(tidy), values };
}

// ── Selections: a click on one visual narrows the others ────────────────

/** The filter that means "only this value of this dimension", or null when one cannot be expressed. */
export function filtersForValue(dim: VizDim, value: string | number | null, type: FieldType): VizFilter[] | null {
  if (value === null || value === "") return [{ field: dim.field, op: "in", values: [null] }];
  if (dim.bin !== undefined) {
    const lo = Number(value);
    return [
      { field: dim.field, op: "gte", values: [lo] },
      { field: dim.field, op: "lte", values: [lo + dim.bin * (1 - 1e-9)] },
    ];
  }
  if (dim.grain) {
    const range = grainRange(String(value), dim.grain);
    return range
      ? [
          { field: dim.field, op: "gte", values: [range[0]] },
          { field: dim.field, op: "lte", values: [range[1]] },
        ]
      : null;
  }
  return [{ field: dim.field, op: "in", values: [type === "number" ? Number(value) : String(value)] }];
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** The first and last day a period label covers ("2026-Q3" → 1 Jul to 30 Sep). */
export function grainRange(value: string, grain: Grain): [string, string] | null {
  const y = Number(value.slice(0, 4));
  if (!Number.isFinite(y)) return null;
  if (grain === "year") return [`${y}-01-01`, `${y}-12-31`];
  if (grain === "quarter") {
    const q = Number(value.slice(6, 7));
    if (!(q >= 1 && q <= 4)) return null;
    return [`${y}-${pad(q * 3 - 2)}-01`, iso(new Date(Date.UTC(y, q * 3, 0)))];
  }
  if (grain === "month") {
    const m = Number(value.slice(5, 7));
    if (!(m >= 1 && m <= 12)) return null;
    return [`${y}-${pad(m)}-01`, iso(new Date(Date.UTC(y, m, 0)))];
  }
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (grain === "day") return [day, day];
  const start = new Date(`${day}T00:00:00Z`);
  return [day, iso(new Date(start.getTime() + 6 * 86_400_000))];
}

/** True when today falls inside the period a label covers: the period is not over, so its figure is not final. */
export function isCurrentPeriod(value: string | number | null, grain: Grain | undefined): boolean {
  if (!grain || value === null) return false;
  const range = grainRange(String(value), grain);
  if (!range) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return range[0] <= today && today <= range[1];
}

export const newViz = (source: string): VizSpec => ({ kind: "bar", source, rows: [], columns: [], values: [], filters: [], options: {} });
