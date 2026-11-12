import { describe, it, expect, vi } from 'vitest';
import { hasSpeciesInfo, leafToneShift, resolveTreeKind, treeKindParams } from '../core/treeSpeciesRegistry.js';
import { SPECIES_PROFILES } from '../core/TreeGenerator.js';

describe('rejestr rodzajów drzew 3D', () => {
  it('rodzaj łaciński i nazwa polska prowadzą do gatunku generatora albo dopasowanego profilu', () => {
    expect(resolveTreeKind({ genus: 'Quercus' })).toBe('Oak');
    expect(resolveTreeKind({ nameLatin: 'Tilia cordata' })).toBe('Linden');
    expect(resolveTreeKind({ namePolish: 'klon zwyczajny' })).toBe('Sycamore');
    expect(resolveTreeKind({ genus: 'Salix', nameLatin: 'Salix babylonica' })).toBe('Weeping Willow');
    expect(resolveTreeKind({ genus: 'Salix' })).toBe('WILLOW');
    expect(resolveTreeKind({ nameLatin: 'Populus tremula' })).toBe('Quaking Aspen');
    expect(resolveTreeKind({ genus: 'Picea' })).toBe('SPRUCE');
  });

  it('gatunki samplera Standardu Zieleni i braki danych', () => {
    expect(resolveTreeKind({ species: 'MAPLE' })).toBe('Sycamore');
    expect(resolveTreeKind({ species: 'PINE' })).toBe('PINE');
    expect(resolveTreeKind({ leafType: 'needleleaved' })).toBe('SPRUCE');
    expect(resolveTreeKind({})).toBe('Linden');
  });

  it('profil dopasowany ma pierwszeństwo przed gatunkiem bazowym', () => {
    const linden = treeKindParams('Linden');
    expect(linden.profile).toBeDefined();
    expect(linden.species in SPECIES_PROFILES).toBe(true);
    expect(treeKindParams('Viburnum').form).toBe('MULTI');
    expect(treeKindParams('OAK').species).toBe('OAK');
    expect(treeKindParams('OAK').profile).toBeDefined();

    // Weryfikacja nowo zintegrowanych profili: Plane i Black Poplar
    const plane = treeKindParams('Plane', 15);
    expect(plane.profile).toBeDefined();
    expect(plane.species).toBe('OAK');
    expect(plane.profile?.crownSpreadRatio).toBeCloseTo(0.439, 2);

    const poplar = treeKindParams('Black Poplar', 24);
    expect(poplar.profile).toBeDefined();
    expect(poplar.species).toBe('POPLAR');
    expect(poplar.profile?.crownShape).toBe('OVOID_COLUMN');
  });
});

describe('tony listowia rodzajów', () => {
  it('przesuwa gatunki zgodnie z cechami: lipa cieplej, świerk chłodniej, dąb ciemniej, osika bledziej', () => {
    expect(leafToneShift('Linden').hue).toBeLessThan(0);
    expect(leafToneShift('SPRUCE').hue).toBeGreaterThan(0);
    expect(leafToneShift('OAK').lightness).toBeLessThan(1);
    expect(leafToneShift('Quaking Aspen').saturation).toBeLessThan(1);
    expect(leafToneShift('BUSH')).toEqual({ hue: 0, saturation: 1, lightness: 1 });
    expect(leafToneShift(null)).toEqual({ hue: 0, saturation: 1, lightness: 1 });
    // klon i lipa (najczęstsze w mieście) wyraźnie różne
    expect(Math.abs(leafToneShift('Linden').lightness - leafToneShift('Sycamore').lightness)).toBeGreaterThan(0.15);
  });

  it('gatunek nieznany, gdy drzewo nie ma rodzaju ani nazwy', () => {
    expect(hasSpeciesInfo({ leafType: 'broadleaved', nameLatin: '', namePolish: '' })).toBe(false);
    expect(hasSpeciesInfo({ genus: 'Acer' })).toBe(true);
    expect(resolveTreeKind({ genus: 'Platanus' })).toBe('Plane');
  });

  it('nieznany rodzaj ostrzega z identyfikatorem i spada na OAK; znane rodzaje nie ostrzegają', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const kind of ['OAK', 'Oak', 'Plane', 'Black Poplar', 'Linden']) treeKindParams(kind as never, 10);
      expect(warn).not.toHaveBeenCalled();
      const p = treeKindParams('Nieznany-xyz' as never, 10);
      expect(p.species).toBe('OAK');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('Nieznany-xyz');
    } finally {
      warn.mockRestore();
    }
  });
});
