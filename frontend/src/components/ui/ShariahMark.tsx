import { Box, Tooltip } from '@mui/material';
import mark from '../../assets/shariah-compliant.png';

const LABEL = 'Shariah compliant · PSX-KMI All Share member';

/**
 * The PSX-KMI All Share (Shariah) mark, set immediately to the right of a ticker.
 *
 * The source is index membership as published — not a screen we ran. The tooltip says which list,
 * so the mark never reads as our own ruling. `alt` carries the same fact for anyone who cannot see
 * the 14px glyph, and the image is transparent so it sits on both themes without a white tile.
 */
export function ShariahMark({ size = 16 }: { size?: number }) {
  return (
    <Tooltip title={LABEL}>
      <Box
        component="img"
        src={mark}
        alt="Shariah compliant"
        sx={{
          width: size,
          height: size,
          display: 'inline-block',
          verticalAlign: '-0.15em',
          flexShrink: 0,
        }}
      />
    </Tooltip>
  );
}
