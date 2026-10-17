"""Entidades del modelo de dominio de ganadería extensiva."""
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from src.domain.value_objects import Crotal, ExplotacionCEA, PeriodoSupresion


@dataclass
class Animal:
    """Entidad que representa una cabeza de ganado en el censo."""
    crotal: Crotal
    nombre: Optional[str]
    sexo: str
    raza: str
    fecha_nacimiento: date
    madre_crotal: Optional[str]
    padre_crotal: Optional[str]
    estado: str  # 'A' = Activo (alta en censo), 'B' = Baja (muerte o venta)
    vida: int    # 1 = Ganado para vida (reproducción / nodrizas), 0 = Cebo (carne)
    corral: str  # Lote o cercado de pasto (ej: DUEÑA, ESPADAÑA)
    fecha_alta: date
    fecha_ult_parto: Optional[date] = None
    total_partos: int = 0

    @property
    def es_activo(self) -> bool:
        return self.estado.strip().upper() == "A"

    @property
    def es_reproductora(self) -> bool:
        return self.es_activo and self.vida == 1 and (self.sexo == "Vaca" or "Hembra" in self.sexo)


    def edad_anios(self, fecha_referencia: Optional[date] = None) -> float:
        ref = fecha_referencia or date.today()
        dias = (ref - self.fecha_nacimiento).days
        return round(dias / 365.25, 1)


@dataclass
class Parto:
    """Registro de alumbramiento de una vaca nodriza."""
    madre_crotal: str
    fecha_parto: date
    cria_crotal: Optional[str]
    cria_sexo: str  # 'Macho' o 'Hembra'
    incidencias: Optional[str] = None
    id: Optional[int] = None


@dataclass
class RecetaSanitaria:
    """Prescripción médica veterinaria y tratamiento farmacológico por lote."""
    fecha: date
    receta: str
    medicamento: str
    unidades: float
    dosis_unitaria: float
    n_animales: int
    veterinario: str
    periodo_supresion: PeriodoSupresion
    proveedor: str
    cea: ExplotacionCEA
    id: Optional[int] = None

    def fecha_limite_carne(self) -> Optional[date]:
        return self.periodo_supresion.calcular_fin_carne(self.fecha)


@dataclass
class Movimiento:
    """Movimiento de un animal entre explotaciones, traslados internos o bajas."""
    crotal: str
    fecha: date
    tipo: str  # NACIMIENTO, TRASPASO, SACRIFICIO, VENTA, MUERTE
    origen: ExplotacionCEA
    destino: ExplotacionCEA
    corral: Optional[str] = None
    id: Optional[int] = None

    @property
    def es_traspaso_interno(self) -> bool:
        """Determina si el movimiento ocurrió entre fincas de la propia ganadería."""
        return self.origen.es_explotacion_propia and self.destino.es_explotacion_propia

    @property
    def es_traspaso_a_cebadero(self) -> bool:
        """Determina si fue el destete y traslado desde pasto (121) a cebadero (122)."""
        return self.origen.es_vida and self.destino.es_cebo


@dataclass
class CompraAlimento:
    """Albarán de suministro de piensos, rastrojeras o materias primas."""
    fecha: date
    alimento: str
    kg: float
    importe: float
    precio_kg: float
    albaran: Optional[str]
    proveedor: str
    pagado: bool = True
    id: Optional[int] = None


@dataclass
class Usuario:
    """Entidad que representa un usuario u operario del sistema ganadero."""
    id: str
    nombre: str
    rol: str  # Interno/heredado del schema; sin permisos (login KISS por contraseña)
    pin_hash: str
    password_hash: Optional[str] = None
    activo: bool = True
    creado_en: Optional[str] = None


@dataclass
class VentaLiquidacion:
    """Liquidación oficial de venta de ganado a matadero o cooperativa."""
    numero_factura: str
    fecha_factura: Optional[date] = None
    fecha_pago: Optional[date] = None
    cliente_cooperativa: str = "GANAVAEX, S.COOP"
    cif_cliente: str = "F37335411"
    total_cabezas: Optional[float] = None
    total_kilos_canal: Optional[float] = None
    base_imponible: Optional[float] = None
    porcentaje_iva: float = 10.50
    cuota_iva: Optional[float] = None
    gastos_total: Optional[float] = None
    total_factura: Optional[float] = None
    archivo_origen: Optional[str] = None
    id: Optional[int] = None


@dataclass
class VentaCanal:
    """Canal o cabeza individual liquidada en matadero con peso y precio canal."""
    factura_id: int
    linea_numero: int
    articulo: str
    cabezas: float = 1.0
    peso_canal_kg: Optional[float] = None
    precio_unitario: Optional[float] = None
    importe_linea: Optional[float] = None
    referencia: Optional[str] = None
    fecha_salida_lote: Optional[date] = None
    crotal_asignado: Optional[str] = None
    id: Optional[int] = None


@dataclass
class Pesaje:
    """Registro de peso vivo de un animal en báscula de manga o tolva."""
    crotal: str
    fecha: date
    peso_kg: float
    tipo: str = "Control"  # Destete, Control, Salida, Entrada
    notas: Optional[str] = None
    operador: Optional[str] = None
    id: Optional[int] = None

    @staticmethod
    def calcular_gmd(p_anterior: "Pesaje", p_actual: "Pesaje") -> Optional[float]:
        """Calcula la Ganancia Media Diaria en kg/día entre dos pesajes consecutivos."""
        dias = (p_actual.fecha - p_anterior.fecha).days
        if dias <= 0:
            return None
        delta_kg = p_actual.peso_kg - p_anterior.peso_kg
        return round(delta_kg / dias, 3)

    @staticmethod
    def calcular_rendimiento_canal(peso_canal_kg: float, peso_vivo_kg: float) -> Optional[float]:
        """Calcula el porcentaje de rendimiento a la canal: (peso canal / peso vivo) * 100."""
        if peso_vivo_kg <= 0:
            return None
        return round((peso_canal_kg / peso_vivo_kg) * 100, 2)


@dataclass
class TratamientoIndividual:
    """Tratamiento veterinario aplicado individualmente a un animal con periodo de retirada."""
    crotal: str
    fecha_inicio: date
    medicamento: str
    fecha_fin: Optional[date] = None
    veterinario: Optional[str] = None
    causa: Optional[str] = None
    dias_retirada: int = 0
    fecha_fin_retirada: Optional[date] = None
    id: Optional[int] = None

    def esta_en_retirada(self, fecha_ref: Optional[date] = None) -> bool:
        """Determina si en la fecha de referencia el animal se encuentra en periodo de retirada."""
        ref = fecha_ref or date.today()
        fin_retirada = self.fecha_fin_retirada
        if not fin_retirada and self.dias_retirada > 0:
            base = self.fecha_fin or self.fecha_inicio
            fin_retirada = base + timedelta(days=self.dias_retirada)
        elif not fin_retirada:
            fin_retirada = self.fecha_fin

        if not fin_retirada:
            return False
        return self.fecha_inicio <= ref <= fin_retirada


