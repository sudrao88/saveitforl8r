
import { Memory } from '../types.ts';

export const memoriesToCSV = (memories: Memory[]): string => {
  // Define columns
  const headers = ['id', 'timestamp', 'date_iso', 'content', 'type', 'tags', 'summary', 'location_json', 'attachments_json', 'enrichment_json'];
  
  const escape = (val: string | number | undefined | null) => {
    if (val === undefined || val === null) return '';
    const stringified = String(val);
    if (stringified.includes('"') || stringified.includes(',') || stringified.includes('\n') || stringified.includes('\r')) {
      return `"${stringified.replace(/"/g, '""')}"`;
    }
    return stringified;
  };

  const rows = memories.map(m => {
    const type = m.enrichment?.entityContext?.type || '';
    const summary = m.enrichment?.summary || '';
    const date = new Date(m.timestamp).toISOString();
    
    // Clean enrichment data (remove legacy audit field from pre-proxy data)
    const cleanEnrichment = m.enrichment ? { ...m.enrichment } as Record<string, unknown> : null;
    if (cleanEnrichment) {
        delete cleanEnrichment.audit;
    }

    return [
      m.id,
      m.timestamp,
      date,
      m.content,
      type,
      m.tags.join('|'),
      summary,
      JSON.stringify(m.location || null),
      JSON.stringify(m.attachments || []),
      JSON.stringify(cleanEnrichment)
    ].map(escape).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
};

export const parseCSV = (text: string): string[][] => {
    const result: string[][] = [];
    let row: string[] = [];
    let current = "";
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];
  
      if (inQuotes) {
        if (char === '"' && next === '"') {
          current += '"';
          i++; // skip next quote
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          row.push(current);
          current = "";
        } else if (char === '\r' || char === '\n') {
          row.push(current);
          if (row.length > 1 || row[0] !== '') { // Avoid empty rows
            result.push(row);
          }
          row = [];
          current = "";
          // Handle \r\n
          if (char === '\r' && next === '\n') i++;
        } else {
          current += char;
        }
      }
    }
    // Push the last row if exists
    if (current || row.length > 0) {
        row.push(current);
        result.push(row);
    }
    return result;
};

export const csvToMemories = (csv: string): Memory[] => {
  const rows = parseCSV(csv);
  if (rows.length < 2) return []; // Header + 1 row minimum

  // We assume the header order matches export
  // id, timestamp, date_iso, content, type, tags, summary, location_json, attachments_json, enrichment_json
  
  const memories: Memory[] = [];

  // Skip header (index 0)
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    // Basic validation: need at least id, timestamp, content
    if (cols.length < 4) continue;

    try {
        const id = cols[0];
        const timestamp = Number(cols[1]);
        const content = cols[3];
        const tags = cols[5] ? cols[5].split('|').filter(t => t) : [];
        const location = cols[7] && cols[7] !== 'null' ? JSON.parse(cols[7]) : undefined;
        const attachments = cols[8] && cols[8] !== 'null' ? JSON.parse(cols[8]) : undefined;
        let enrichment = cols[9] && cols[9] !== 'null' ? JSON.parse(cols[9]) : undefined;

        // Clean imported enrichment (remove legacy audit field from pre-proxy data)
        if (enrichment && (enrichment as Record<string, unknown>).audit) {
             delete (enrichment as Record<string, unknown>).audit;
        }

        if (id && !isNaN(timestamp)) {
            memories.push({
                id,
                timestamp,
                content,
                tags,
                location,
                attachments,
                enrichment
            });
        }
    } catch (e) {
        console.warn("Failed to parse row", i, e);
    }
  }
  return memories;
}
