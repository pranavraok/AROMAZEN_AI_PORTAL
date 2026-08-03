interface Column<T> {
  header: string
  key: keyof T
  render?: (value: T[keyof T], row: T) => React.ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  compact?: boolean
}

export function DataTable<T extends object>({
  columns,
  data,
  compact = false,
}: DataTableProps<T>) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {columns.map((column) => (
                <th
                  key={String(column.key)}
                  className={`px-6 py-3 text-left font-medium text-muted-foreground ${
                    compact ? 'py-2' : ''
                  } ${column.className || ''}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => {
              const rowId = 'id' in row && typeof row.id === 'string' ? row.id : `row-${index}`

              return (
              <tr
                key={rowId}
                className={`border-b border-border transition-colors hover:bg-muted/30 ${
                  index % 2 === 0 ? '' : ''
                }`}
              >
                {columns.map((column) => (
                  <td
                    key={`${rowId}-${String(column.key)}`}
                    className={`px-6 py-3 text-foreground ${compact ? 'py-2' : ''} ${
                      column.className || ''
                    }`}
                  >
                    {column.render
                      ? column.render(row[column.key], row)
                      : String(row[column.key])}
                  </td>
                ))}
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {data.length === 0 && (
        <div className="px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No data available</p>
        </div>
      )}
    </div>
  )
}
