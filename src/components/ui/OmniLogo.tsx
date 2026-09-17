import type { SVGProps } from "react";

/**
 * ARQUIVO GERADO a partir de `assets/omni-agents-pixel-themeable.svg` — os 708 retângulos do
 * pixel-art viraram um `path` por camada (3× menor que os `<rect>` originais).
 *
 * As seis camadas pintam por variável CSS, então a logo troca de cor junto com a paleta: o
 * `useSettings` escreve `--omni-outline` … `--omni-highlight` no `<html>` a partir da paleta
 * ativa. Os hexadecimais aqui são o fallback laranja do arquivo original — é o que aparece no
 * primeiro quadro, antes do efeito rodar, e em qualquer lugar sem as vars (teste, storybook).
 *
 * O `<style>` do SVG original saiu de propósito: inline no documento, `.shadow`/`.primary`/
 * `.accent` são nomes genéricos demais e vazariam para o resto da página.
 */
const CAMADAS: [variavel: string, fallback: string, d: string][] = [
  ["--omni-outline", "#26040B", "M48 2h1v1h-1zM50 2h1v1h-1zM26 3h13v1h-13zM48 3h1v1h-1zM50 3h1v1h-1zM47 4h1v1h-1zM49 4h1v1h-1zM53 4h2v1h-2zM24 5h1v1h-1zM47 5h1v1h-1zM49 5h1v1h-1zM52 5h1v1h-1zM23 6h1v1h-1zM39 6h2v1h-2zM47 6h3v1h-3zM51 6h1v1h-1zM22 7h1v1h-1zM41 7h1v1h-1zM50 7h1v1h-1zM53 7h2v1h-2zM46 8h3v1h-3zM50 8h1v1h-1zM52 8h1v1h-1zM21 9h1v1h-1zM42 9h1v1h-1zM45 9h1v1h-1zM49 9h1v1h-1zM21 10h1v1h-1zM27 10h2v1h-2zM36 10h1v1h-1zM38 10h1v1h-1zM42 10h1v1h-1zM45 10h1v1h-1zM49 10h1v1h-1zM52 10h3v1h-3zM19 11h3v1h-3zM27 11h3v1h-3zM36 11h3v1h-3zM42 11h1v1h-1zM45 11h1v1h-1zM49 11h1v1h-1zM56 11h1v1h-1zM15 12h5v1h-5zM27 12h3v1h-3zM36 12h3v1h-3zM43 12h1v1h-1zM46 12h1v1h-1zM49 12h1v1h-1zM52 12h1v1h-1zM56 12h1v1h-1zM13 13h1v1h-1zM27 13h3v1h-3zM36 13h3v1h-3zM43 13h1v1h-1zM45 13h2v1h-2zM49 13h1v1h-1zM12 14h1v1h-1zM20 14h1v1h-1zM23 14h1v1h-1zM43 14h3v1h-3zM49 14h1v1h-1zM12 15h1v1h-1zM16 15h2v1h-2zM20 15h1v1h-1zM23 15h1v1h-1zM49 15h1v1h-1zM12 16h1v1h-1zM16 16h1v1h-1zM18 16h1v1h-1zM23 16h5v1h-5zM38 16h2v1h-2zM42 16h1v1h-1zM48 16h1v1h-1zM12 17h1v1h-1zM16 17h1v1h-1zM19 17h1v1h-1zM22 17h1v1h-1zM27 17h1v1h-1zM40 17h2v1h-2zM47 17h1v1h-1zM13 18h1v1h-1zM16 18h1v1h-1zM19 18h1v1h-1zM21 18h1v1h-1zM27 18h2v1h-2zM31 18h2v1h-2zM35 18h1v1h-1zM42 18h5v1h-5zM14 19h2v1h-2zM18 19h1v1h-1zM20 19h1v1h-1zM31 19h2v1h-2zM38 19h1v1h-1zM44 19h1v1h-1zM15 20h4v1h-4zM20 20h1v1h-1zM25 20h1v1h-1zM29 20h2v1h-2zM33 20h2v1h-2zM44 20h6v1h-6zM14 21h1v1h-1zM20 21h1v1h-1zM25 21h1v1h-1zM39 21h1v1h-1zM44 21h2v1h-2zM50 21h1v1h-1zM12 22h1v1h-1zM18 22h3v1h-3zM25 22h1v1h-1zM39 22h1v1h-1zM44 22h3v1h-3zM12 23h1v1h-1zM17 23h1v1h-1zM20 23h1v1h-1zM38 23h1v1h-1zM46 23h1v1h-1zM51 23h1v1h-1zM12 24h1v1h-1zM21 24h1v1h-1zM38 24h1v1h-1zM47 24h1v1h-1zM13 25h1v1h-1zM16 25h1v1h-1zM22 25h1v1h-1zM39 25h1v1h-1zM42 25h1v1h-1zM48 25h1v1h-1zM51 25h1v1h-1zM14 26h2v1h-2zM40 26h2v1h-2zM49 26h1v1h-1zM51 26h1v1h-1zM13 27h2v1h-2zM29 27h7v1h-7zM49 27h3v1h-3zM12 28h2v1h-2zM27 28h3v1h-3zM34 28h3v1h-3zM50 28h2v1h-2zM11 29h2v1h-2zM26 29h2v1h-2zM36 29h3v1h-3zM51 29h1v1h-1zM11 30h1v1h-1zM25 30h1v1h-1zM11 31h1v1h-1zM24 31h1v1h-1zM39 31h1v1h-1zM52 31h1v1h-1zM11 32h1v1h-1zM24 32h1v1h-1zM39 32h1v1h-1zM52 32h1v1h-1zM23 33h1v1h-1zM40 33h1v1h-1zM52 33h1v1h-1zM10 34h1v1h-1zM22 34h1v1h-1zM41 34h1v1h-1zM52 34h2v1h-2zM10 35h1v1h-1zM22 35h1v1h-1zM41 35h1v1h-1zM53 35h1v1h-1zM10 36h1v1h-1zM21 36h2v1h-2zM41 36h2v1h-2zM53 36h1v1h-1zM10 37h1v1h-1zM21 37h1v1h-1zM42 37h1v1h-1zM53 37h1v1h-1zM10 38h1v1h-1zM21 38h1v1h-1zM42 38h1v1h-1zM53 38h1v1h-1zM10 39h1v1h-1zM21 39h1v1h-1zM42 39h1v1h-1zM53 39h1v1h-1zM10 40h1v1h-1zM21 40h1v1h-1zM42 40h1v1h-1zM53 40h1v1h-1zM10 41h1v1h-1zM21 41h1v1h-1zM42 41h1v1h-1zM53 41h1v1h-1zM10 42h1v1h-1zM21 42h1v1h-1zM42 42h1v1h-1zM53 42h1v1h-1zM10 43h1v1h-1zM21 43h1v1h-1zM42 43h1v1h-1zM53 43h1v1h-1zM10 44h1v1h-1zM22 44h1v1h-1zM41 44h1v1h-1zM53 44h1v1h-1zM10 45h1v1h-1zM22 45h1v1h-1zM41 45h1v1h-1zM53 45h1v1h-1zM10 46h2v1h-2zM23 46h1v1h-1zM41 46h1v1h-1zM52 46h2v1h-2zM11 47h1v1h-1zM23 47h1v1h-1zM40 47h1v1h-1zM52 47h1v1h-1zM11 48h1v1h-1zM24 48h1v1h-1zM39 48h1v1h-1zM51 48h2v1h-2zM11 49h1v1h-1zM24 49h2v1h-2zM38 49h2v1h-2zM51 49h1v1h-1zM11 50h2v1h-2zM25 50h2v1h-2zM38 50h1v1h-1zM51 50h1v1h-1zM12 51h1v1h-1zM26 51h2v1h-2zM36 51h3v1h-3zM51 51h1v1h-1zM13 52h1v1h-1zM29 52h1v1h-1zM35 52h1v1h-1zM50 52h1v1h-1zM14 53h1v1h-1zM49 53h2v1h-2zM14 54h2v1h-2zM48 54h2v1h-2zM15 55h2v1h-2zM47 55h2v1h-2zM16 56h1v1h-1zM47 56h1v1h-1zM17 57h1v1h-1zM45 57h2v1h-2zM18 58h2v1h-2zM44 58h2v1h-2zM20 59h1v1h-1zM42 59h2v1h-2zM21 60h1v1h-1zM41 60h2v1h-2zM22 61h4v1h-4zM38 61h4v1h-4zM26 62h12v1h-12z"],
  ["--omni-shadow", "#9D201A", "M25 4h1v1h-1zM50 4h1v1h-1zM25 5h1v1h-1zM21 8h1v1h-1zM42 8h1v1h-1zM19 13h1v1h-1zM19 16h1v1h-1zM21 16h2v1h-2zM26 19h1v1h-1zM33 19h1v1h-1zM32 20h1v1h-1zM51 22h1v1h-1zM26 23h1v1h-1zM16 24h1v1h-1zM26 24h1v1h-1zM43 24h1v1h-1zM51 24h1v1h-1zM15 25h1v1h-1zM30 26h4v1h-4zM36 27h1v1h-1zM26 28h1v1h-1zM25 29h1v1h-1zM39 30h1v1h-1zM11 33h1v1h-1zM11 34h1v1h-1zM20 35h1v1h-1zM20 36h1v1h-1zM52 36h1v1h-1zM20 37h1v1h-1zM52 37h1v1h-1zM20 38h1v1h-1zM52 38h1v1h-1zM20 39h1v1h-1zM52 39h1v1h-1zM20 40h1v1h-1zM52 40h1v1h-1zM20 41h1v1h-1zM52 41h1v1h-1zM20 42h1v1h-1zM52 42h1v1h-1zM52 43h1v1h-1zM51 44h2v1h-2zM51 45h2v1h-2zM51 46h1v1h-1zM51 47h1v1h-1zM50 49h1v1h-1zM50 50h1v1h-1zM50 51h1v1h-1zM14 52h1v1h-1zM27 52h2v1h-2zM32 52h1v1h-1zM36 52h1v1h-1zM49 52h1v1h-1zM48 53h1v1h-1zM47 54h1v1h-1zM46 55h1v1h-1zM17 56h1v1h-1zM45 56h2v1h-2zM44 57h1v1h-1zM42 58h2v1h-2zM41 59h1v1h-1zM40 60h1v1h-1zM26 61h1v1h-1zM35 61h3v1h-3z"],
  ["--omni-primary", "#F45C27", "M38 4h1v1h-1zM48 4h1v1h-1zM29 5h10v1h-10zM48 5h1v1h-1zM27 6h12v1h-12zM54 6h1v1h-1zM25 7h16v1h-16zM51 7h2v1h-2zM22 8h1v1h-1zM25 8h17v1h-17zM24 9h18v1h-18zM47 9h2v1h-2zM23 10h4v1h-4zM30 10h6v1h-6zM39 10h3v1h-3zM47 10h2v1h-2zM23 11h4v1h-4zM30 11h6v1h-6zM39 11h3v1h-3zM47 11h2v1h-2zM52 11h2v1h-2zM22 12h5v1h-5zM30 12h6v1h-6zM39 12h4v1h-4zM47 12h2v1h-2zM16 13h3v1h-3zM20 13h7v1h-7zM30 13h6v1h-6zM39 13h4v1h-4zM47 13h2v1h-2zM15 14h5v1h-5zM21 14h2v1h-2zM24 14h19v1h-19zM46 14h3v1h-3zM14 15h2v1h-2zM18 15h2v1h-2zM21 15h2v1h-2zM24 15h25v1h-25zM14 16h2v1h-2zM20 16h1v1h-1zM28 16h10v1h-10zM40 16h2v1h-2zM43 16h5v1h-5zM13 17h3v1h-3zM20 17h2v1h-2zM26 17h1v1h-1zM28 17h10v1h-10zM42 17h5v1h-5zM14 18h2v1h-2zM20 18h1v1h-1zM23 18h4v1h-4zM29 18h2v1h-2zM33 18h2v1h-2zM36 18h4v1h-4zM19 19h1v1h-1zM23 19h3v1h-3zM27 19h4v1h-4zM34 19h4v1h-4zM39 19h3v1h-3zM43 19h1v1h-1zM19 20h1v1h-1zM23 20h2v1h-2zM26 20h3v1h-3zM31 20h1v1h-1zM35 20h7v1h-7zM43 20h1v1h-1zM17 21h3v1h-3zM22 21h3v1h-3zM26 21h1v1h-1zM35 21h4v1h-4zM40 21h4v1h-4zM46 21h1v1h-1zM49 21h1v1h-1zM15 22h3v1h-3zM22 22h3v1h-3zM38 22h1v1h-1zM41 22h3v1h-3zM47 22h4v1h-4zM14 23h3v1h-3zM18 23h2v1h-2zM22 23h4v1h-4zM41 23h4v1h-4zM47 23h4v1h-4zM14 24h2v1h-2zM22 24h4v1h-4zM30 24h6v1h-6zM40 24h3v1h-3zM44 24h2v1h-2zM48 24h3v1h-3zM14 25h1v1h-1zM23 25h4v1h-4zM28 25h9v1h-9zM40 25h2v1h-2zM43 25h1v1h-1zM46 25h2v1h-2zM49 25h2v1h-2zM23 26h7v1h-7zM34 26h6v1h-6zM42 26h1v1h-1zM47 26h2v1h-2zM50 26h1v1h-1zM25 27h4v1h-4zM37 27h6v1h-6zM47 27h2v1h-2zM25 28h1v1h-1zM37 28h5v1h-5zM48 28h2v1h-2zM23 29h2v1h-2zM39 29h2v1h-2zM49 29h2v1h-2zM22 30h3v1h-3zM40 30h2v1h-2zM46 30h1v1h-1zM48 30h1v1h-1zM50 30h2v1h-2zM21 31h3v1h-3zM40 31h3v1h-3zM45 31h1v1h-1zM49 31h3v1h-3zM21 32h3v1h-3zM40 32h12v1h-12zM20 33h3v1h-3zM41 33h11v1h-11zM20 34h2v1h-2zM42 34h1v1h-1zM44 34h8v1h-8zM12 35h1v1h-1zM21 35h1v1h-1zM42 35h2v1h-2zM45 35h8v1h-8zM12 36h1v1h-1zM43 36h1v1h-1zM45 36h7v1h-7zM16 37h4v1h-4zM43 37h1v1h-1zM45 37h7v1h-7zM15 38h5v1h-5zM43 38h1v1h-1zM45 38h7v1h-7zM15 39h5v1h-5zM43 39h1v1h-1zM45 39h7v1h-7zM12 40h2v1h-2zM15 40h5v1h-5zM43 40h1v1h-1zM45 40h7v1h-7zM12 41h1v1h-1zM14 41h6v1h-6zM43 41h1v1h-1zM45 41h7v1h-7zM12 42h1v1h-1zM14 42h6v1h-6zM43 42h1v1h-1zM45 42h7v1h-7zM12 43h1v1h-1zM14 43h7v1h-7zM43 43h1v1h-1zM45 43h7v1h-7zM12 44h10v1h-10zM42 44h2v1h-2zM45 44h6v1h-6zM12 45h10v1h-10zM42 45h1v1h-1zM45 45h6v1h-6zM12 46h11v1h-11zM42 46h1v1h-1zM44 46h7v1h-7zM12 47h8v1h-8zM21 47h2v1h-2zM41 47h2v1h-2zM44 47h7v1h-7zM12 48h9v1h-9zM22 48h2v1h-2zM40 48h2v1h-2zM44 48h2v1h-2zM47 48h4v1h-4zM12 49h9v1h-9zM22 49h2v1h-2zM40 49h1v1h-1zM43 49h2v1h-2zM47 49h3v1h-3zM13 50h9v1h-9zM23 50h2v1h-2zM39 50h1v1h-1zM42 50h3v1h-3zM46 50h4v1h-4zM13 51h10v1h-10zM24 51h2v1h-2zM41 51h2v1h-2zM46 51h4v1h-4zM15 52h10v1h-10zM26 52h1v1h-1zM37 52h2v1h-2zM40 52h2v1h-2zM45 52h4v1h-4zM15 53h11v1h-11zM28 53h3v1h-3zM39 53h1v1h-1zM44 53h4v1h-4zM16 54h12v1h-12zM41 54h6v1h-6zM17 55h16v1h-16zM40 55h6v1h-6zM18 56h27v1h-27zM18 57h26v1h-26zM20 58h22v1h-22zM21 59h20v1h-20zM22 60h18v1h-18zM27 61h8v1h-8z"],
  ["--omni-secondary", "#FF8F18", "M49 3h1v1h-1zM26 4h11v1h-11zM52 6h2v1h-2zM24 8h1v1h-1zM51 8h1v1h-1zM46 11h1v1h-1zM54 11h2v1h-2zM53 12h3v1h-3zM14 13h2v1h-2zM13 14h1v1h-1zM40 18h1v1h-1zM21 19h1v1h-1zM21 20h1v1h-1zM42 20h1v1h-1zM15 21h2v1h-2zM21 21h1v1h-1zM47 21h2v1h-2zM13 22h2v1h-2zM21 22h1v1h-1zM26 22h1v1h-1zM40 23h1v1h-1zM13 24h1v1h-1zM27 24h1v1h-1zM36 24h2v1h-2zM39 24h1v1h-1zM46 24h1v1h-1zM18 25h1v1h-1zM21 25h1v1h-1zM38 25h1v1h-1zM44 26h2v1h-2zM22 27h3v1h-3zM43 27h3v1h-3zM17 28h1v1h-1zM21 28h4v1h-4zM42 28h6v1h-6zM15 29h2v1h-2zM19 29h4v1h-4zM41 29h8v1h-8zM12 30h1v1h-1zM14 30h2v1h-2zM18 30h4v1h-4zM42 30h4v1h-4zM47 30h1v1h-1zM49 30h1v1h-1zM14 31h2v1h-2zM17 31h4v1h-4zM43 31h2v1h-2zM46 31h3v1h-3zM13 32h8v1h-8zM13 33h2v1h-2zM16 33h4v1h-4zM12 34h3v1h-3zM16 34h4v1h-4zM13 35h1v1h-1zM16 35h4v1h-4zM13 36h1v1h-1zM16 36h4v1h-4zM12 37h2v1h-2zM12 38h2v1h-2zM12 39h2v1h-2zM13 43h1v1h-1zM11 45h1v1h-1zM20 47h1v1h-1zM43 47h1v1h-1zM21 48h1v1h-1zM43 48h1v1h-1zM21 49h1v1h-1zM22 50h1v1h-1zM23 51h1v1h-1zM25 52h1v1h-1zM26 53h2v1h-2zM37 54h2v1h-2zM33 55h5v1h-5z"],
  ["--omni-accent", "#FFB334", "M49 2h1v1h-1zM37 4h1v1h-1zM26 5h3v1h-3zM53 5h2v1h-2zM24 6h3v1h-3zM23 7h2v1h-2zM23 8h1v1h-1zM22 9h2v1h-2zM46 9h1v1h-1zM22 10h1v1h-1zM46 10h1v1h-1zM22 11h1v1h-1zM20 12h2v1h-2zM14 14h1v1h-1zM13 15h1v1h-1zM13 16h1v1h-1zM23 17h3v1h-3zM38 17h2v1h-2zM22 18h1v1h-1zM41 18h1v1h-1zM22 19h1v1h-1zM42 19h1v1h-1zM22 20h1v1h-1zM27 21h8v1h-8zM27 22h11v1h-11zM40 22h1v1h-1zM13 23h1v1h-1zM21 23h1v1h-1zM27 23h11v1h-11zM39 23h1v1h-1zM45 23h1v1h-1zM17 24h4v1h-4zM28 24h2v1h-2zM17 25h1v1h-1zM19 25h2v1h-2zM27 25h1v1h-1zM37 25h1v1h-1zM44 25h2v1h-2zM16 26h4v1h-4zM21 26h2v1h-2zM43 26h1v1h-1zM46 26h1v1h-1zM15 27h3v1h-3zM21 27h1v1h-1zM46 27h1v1h-1zM14 28h3v1h-3zM20 28h1v1h-1zM13 29h2v1h-2zM13 30h1v1h-1zM12 31h2v1h-2zM12 32h1v1h-1zM12 33h1v1h-1zM15 33h1v1h-1zM15 34h1v1h-1zM43 34h1v1h-1zM11 35h1v1h-1zM14 35h2v1h-2zM44 35h1v1h-1zM11 36h1v1h-1zM14 36h2v1h-2zM44 36h1v1h-1zM11 37h1v1h-1zM14 37h2v1h-2zM44 37h1v1h-1zM11 38h1v1h-1zM14 38h1v1h-1zM44 38h1v1h-1zM11 39h1v1h-1zM14 39h1v1h-1zM44 39h1v1h-1zM11 40h1v1h-1zM14 40h1v1h-1zM44 40h1v1h-1zM11 41h1v1h-1zM13 41h1v1h-1zM44 41h1v1h-1zM11 42h1v1h-1zM13 42h1v1h-1zM44 42h1v1h-1zM11 43h1v1h-1zM44 43h1v1h-1zM11 44h1v1h-1zM44 44h1v1h-1zM43 45h2v1h-2zM43 46h1v1h-1zM42 48h1v1h-1zM41 49h2v1h-2zM40 50h2v1h-2zM39 51h2v1h-2zM45 51h1v1h-1zM39 52h1v1h-1zM31 53h8v1h-8zM40 53h1v1h-1zM28 54h9v1h-9zM39 55h1v1h-1z"],
  ["--omni-highlight", "#FFF4D8", "M29 10h1v1h-1zM37 10h1v1h-1zM20 26h1v1h-1zM18 27h3v1h-3zM18 28h2v1h-2zM17 29h2v1h-2zM16 30h2v1h-2zM16 31h1v1h-1zM46 48h1v1h-1zM45 49h2v1h-2zM45 50h1v1h-1zM43 51h2v1h-2zM42 52h3v1h-3zM41 53h3v1h-3zM39 54h2v1h-2zM38 55h1v1h-1z"],
];

/** Nome de cada camada, na ordem de pintura. Espelha as chaves de `coresDaLogo`. */
export type CamadaDaLogo = "outline" | "shadow" | "primary" | "secondary" | "accent" | "highlight";

/** `viewBox` quadrado e recortado no desenho: a arte nasce 47×61 dentro de uma tela 64×66 cheia
 *  de margem morta, e usá-la crua esmagaria a logo num slot quadrado. */
const VIEW_BOX = "2 1 63 63";
/** Lado do `viewBox`, em unidades. Rasterizar num múltiplo inteiro dele mantém o pixel quadrado. */
export const LADO_DA_LOGO = 63;

/**
 * A mesma logo como texto SVG, com as cores embutidas em vez de `var()`.
 *
 * Serve para rasterizar fora do documento (o ícone da janela), onde não existe elemento para
 * herdar variável de tema nenhuma.
 */
export function svgDaLogo(cores: Record<CamadaDaLogo, string>, lado: number): string {
  const camadas = CAMADAS.map(
    ([variavel, , d]) => `<path d="${d}" fill="${cores[variavel.replace("--omni-", "") as CamadaDaLogo]}"/>`
  ).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}" width="${lado}" height="${lado}"` +
    ` shape-rendering="crispEdges">${camadas}</svg>`
  );
}

type OmniLogoProps = SVGProps<SVGSVGElement> & { size?: number | string };

/** Logo do OMNI AGENTS. `viewBox` quadrado e recortado no desenho, para caber num slot `w-7 h-7`
 *  sem esmagar (a arte nasce 47×61 dentro de uma tela 64×66 cheia de margem morta). */
export function OmniLogo({ size, ...props }: OmniLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={VIEW_BOX}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {CAMADAS.map(([variavel, fallback, d]) => (
        <path key={variavel} d={d} fill={`var(${variavel}, ${fallback})`} />
      ))}
    </svg>
  );
}
