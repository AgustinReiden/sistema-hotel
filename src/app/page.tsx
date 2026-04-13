import Link from "next/link";
import Image from "next/image";
import { Star, MapPin, UtensilsCrossed, BedDouble, Fuel, Instagram, Phone, Mail } from "lucide-react";
import PublicSearchForm from "./components/PublicSearchForm";
import RoomCarousel from "./components/RoomCarousel";
import ScrollToResults from "./components/ScrollToResults";
import { determineSmarterAvailableRooms, getAllRooms, getAvailableRooms, getHotelSettings } from "@/lib/data";
import { buildPublicRoomOffers, getRoomCapacity } from "@/lib/rooms";

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const checkin = typeof params.checkin === "string" ? params.checkin : undefined;
  const checkout = typeof params.checkout === "string" ? params.checkout : undefined;
  const guestsParam = typeof params.guests === "string" ? params.guests : undefined;

  const isSearching = !!checkin && !!checkout;

  const allRooms = await getAllRooms();
  const publicRooms = allRooms.filter((room) => room.is_active);
  const availableRooms = isSearching ? await getAvailableRooms(checkin, checkout) : [];
  const settings = await getHotelSettings();

  const searchGuests = guestsParam ? parseInt(guestsParam, 10) : 0;
  const catalogOffers = buildPublicRoomOffers(publicRooms, "catalog");
  const directAvailableRooms =
    isSearching && searchGuests > 0
      ? availableRooms.filter((room) => getRoomCapacity(room) >= searchGuests)
      : availableRooms;
  const availableOffers = buildPublicRoomOffers(directAvailableRooms, "available");
  const comboRooms =
    isSearching && searchGuests > 0 && availableOffers.length === 0
      ? determineSmarterAvailableRooms(availableRooms, searchGuests)
      : [];
  const comboOffers = buildPublicRoomOffers(comboRooms, "combination");
  const visibleOffers = isSearching
    ? availableOffers.length > 0
      ? availableOffers
      : comboOffers
    : catalogOffers;
  const hasVisibleOffers = visibleOffers.length > 0;

  let comboMessage: string | null = null;

  if (isSearching && availableOffers.length === 0 && comboOffers.length > 0 && searchGuests > 0) {
    const parts = comboOffers.map(
      (offer) =>
        `${offer.roomCount} ${offer.roomCount === 1 ? "habitaci\u00f3n" : "habitaciones"} ${offer.roomType}`
    );
    comboMessage = `No encontramos una sola categor\u00eda para ${searchGuests} personas, pero s\u00ed esta combinaci\u00f3n disponible: ${parts.join(" y ")}.`;
  }

  return (
    <div className="min-h-screen bg-stone-50 selection:bg-brand-500 selection:text-white font-sans scroll-smooth">
      {isSearching && <ScrollToResults />}

      {/* ── Navbar ── */}
      <nav className="absolute w-full z-50">
        <div className="max-w-7xl mx-auto px-6 h-24 flex items-center justify-between">
          {/* Logo con fondo blanco sutil para contraste */}
          <Link href="/" className="shrink-0">
            {settings?.logo_url ? (
              <div className="relative w-36 h-36 flex items-center justify-center bg-white/85 rounded-xl p-2 shadow-lg">
                <Image src={settings.logo_url} alt={settings?.name || "El Refugio"} fill className="object-contain p-1" />
              </div>
            ) : (
              <div className="w-14 h-14 bg-white/85 backdrop-blur-md rounded-xl flex items-center justify-center shadow-lg">
                <Star className="text-brand-700 fill-brand-600" size={24} />
              </div>
            )}
          </Link>

          <div className="hidden md:flex gap-8 items-center text-sm font-semibold tracking-wide text-white/90 uppercase">
            <a href="#habitaciones" className="hover:text-white transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[2px] after:bg-brand-400 after:transition-all hover:after:w-full">
              Habitaciones
            </a>
            <a href="#servicios" className="hover:text-white transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[2px] after:bg-brand-400 after:transition-all hover:after:w-full">
              Servicios
            </a>
            <a href="#ubicacion" className="hover:text-white transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[2px] after:bg-brand-400 after:transition-all hover:after:w-full">
              Ubicaci&oacute;n
            </a>
            <Link
              href="/admin"
              className="ml-2 px-5 py-2.5 rounded-lg bg-white/10 backdrop-blur-md text-white border border-white/20 hover:bg-white hover:text-slate-900 transition-all duration-300"
            >
              Acceso Staff
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero + Habitaciones (imagen de fondo continua) ── */}
      <div className="relative overflow-hidden">
        {/* Imagen de fondo que cubre hero + habitaciones */}
        <div className="absolute inset-0">
          <Image
            src={settings?.hero_image_url || "https://images.unsplash.com/photo-1545642412-ea820db826a7?auto=format&fit=crop&q=80&w=2000"}
            alt="Hotel El Refugio"
            fill
            priority
            className="object-cover"
          />
          <div className="absolute inset-0 bg-black/45"></div>
        </div>

        {/* ── Hero Section ── */}
        <section className="relative z-10 min-h-[92vh] flex items-center justify-center">
          <div className="max-w-7xl mx-auto px-6 w-full flex flex-col items-center gap-12 md:gap-16 pt-32 pb-16">
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-serif font-bold text-white text-center leading-[1.1] tracking-tight animate-fade-up hero-title" style={{ animationDelay: '0.1s' }}>
              {settings?.hero_title || "Tu refugio en el camino"}
            </h1>

            <div id="buscar-fechas" className="w-full max-w-5xl animate-fade-up" style={{ animationDelay: '0.3s' }}>
              <PublicSearchForm />
            </div>
          </div>
        </section>

        {/* ── Seccion Habitaciones ── */}
        <section id="habitaciones" className="relative z-10 py-24 scroll-mt-20">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-16">
              <p className="text-xs font-bold tracking-[0.3em] text-brand-400 uppercase mb-3">Alojamiento</p>
              <h2 className="text-4xl md:text-5xl font-serif text-white mb-6">
                {isSearching ? "Disponibilidad por Categor\u00eda" : "Nuestras Categor\u00edas"}
              </h2>
              <div className="w-16 h-[2px] bg-brand-400 mx-auto mb-6"></div>
              <p className="text-white/70 max-w-2xl mx-auto text-lg font-light leading-relaxed">
                {isSearching
                  ? `Mostrando tipos disponibles del ${new Date(`${checkin}T12:00:00Z`).toLocaleDateString("es-AR")} al ${new Date(`${checkout}T12:00:00Z`).toLocaleDateString("es-AR")}`
                  : "Tipos de habitaci\u00f3n c\u00f3modos y silenciosos, pensados para que descanses de verdad despu\u00e9s de la ruta."}
              </p>
            </div>

            {comboMessage && (
              <div className="max-w-3xl mx-auto mb-10 p-6 bg-white/10 backdrop-blur-sm border border-white/20 text-white rounded-xl text-center shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500">
                <p className="text-lg font-medium">{comboMessage}</p>
                <p className="text-sm text-white/70 mt-2">
                  Esta opci\u00f3n requiere coordinar m\u00e1s de una habitaci\u00f3n.
                </p>
              </div>
            )}

            <div className="md:px-8">
              {hasVisibleOffers && (
                <RoomCarousel
                  offers={visibleOffers}
                  checkIn={checkin || ""}
                  checkOut={checkout || ""}
                  checkInTime={settings.standard_check_in_time?.substring(0, 5)}
                  checkOutTime={settings.standard_check_out_time?.substring(0, 5)}
                  timezone={settings.timezone}
                />
              )}
            </div>

            {isSearching && !hasVisibleOffers && (
              <div className="mt-16 max-w-2xl mx-auto p-12 bg-white/10 backdrop-blur-sm border border-white/20 text-center rounded-2xl shadow-sm">
                <h3 className="text-2xl font-serif text-white mb-3">Sin disponibilidad</h3>
                <p className="text-white/70 font-light leading-relaxed">
                  Lamentablemente, no encontramos tipos de habitaci&oacute;n disponibles para las fechas y cantidad de hu&eacute;spedes seleccionadas.
                  Le invitamos a probar con otro rango de fechas.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── Servicios ── */}
      <section id="servicios" className="py-24 bg-white border-y border-stone-200 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-xs font-bold tracking-[0.3em] text-brand-600 uppercase mb-3">Facilidades</p>
            <h2 className="text-4xl md:text-5xl font-serif text-slate-900 mb-4">
              Servicios Integrales de Ruta
            </h2>
            <div className="w-16 h-[2px] bg-brand-500 mb-8"></div>
            <p className="text-slate-500 font-light text-lg mb-12 leading-relaxed">
              En El Refugio entendemos el valor de tu tiempo y la importancia de un buen descanso. Todo lo que necesit&aacute;s en un solo lugar.
            </p>

            <div className="space-y-8">
              {/* Comedor Regional */}
              <div className="flex items-start gap-5 group">
                <div className="mt-0.5 w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center shrink-0 border border-orange-100 group-hover:bg-orange-100 transition-colors">
                  <UtensilsCrossed size={22} className="text-orange-600" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-900 mb-1">Comedor Regional</h4>
                  <p className="text-slate-500 font-light text-sm leading-relaxed">Platos caseros y abundantes con el sabor del norte, ideales para reponer fuerzas en cualquier momento del d&iacute;a.</p>
                </div>
              </div>

              {/* Hotel */}
              <div className="flex items-start gap-5 group">
                <div className="mt-0.5 w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center shrink-0 border border-brand-100 group-hover:bg-brand-100 transition-colors">
                  <BedDouble size={22} className="text-brand-700" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-900 mb-1">Hotel El Refugio</h4>
                  <p className="text-slate-500 font-light text-sm leading-relaxed">Habitaciones dise&ntilde;adas para un descanso real, silenciosas y seguras, pensadas espec&iacute;ficamente para el viajero y el transportista.</p>
                </div>
              </div>

              {/* Repuestera y Combustibles */}
              <div className="flex items-start gap-5 group">
                <div className="mt-0.5 w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 border border-blue-100 group-hover:bg-blue-100 transition-colors">
                  <Fuel size={22} className="text-blue-600" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-900 mb-1">Repuestera y Combustibles</h4>
                  <p className="text-slate-500 font-light text-sm leading-relaxed">Carga de combustible de confianza y un stock estrat&eacute;gico de repuestos cr&iacute;ticos para resolver cualquier imprevisto mec&aacute;nico en el acto.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Imagen de servicios */}
          <div className="relative h-[550px] w-full rounded-2xl overflow-hidden shadow-2xl shadow-slate-200/50">
            <Image
              src={settings?.services_image_url || "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&q=80&w=1000"}
              alt="Servicios del Hotel"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer id="ubicacion" className="bg-slate-950 text-slate-400 py-20 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row gap-12 justify-between">
          {/* Solo logo, sin texto */}
          <div className="max-w-md">
            <div className="mb-8">
              {settings?.logo_url ? (
                <div className="relative w-24 h-24 flex items-center justify-center">
                  <Image src={settings.logo_url} alt={settings?.name || "El Refugio"} fill className="object-contain brightness-0 invert" />
                </div>
              ) : (
                <div className="w-14 h-14 bg-white/10 flex items-center justify-center rounded-xl border border-white/10">
                  <Star className="text-white fill-white/80" size={24} />
                </div>
              )}
            </div>
            {settings?.address && (
              <p className="text-slate-500 font-light text-sm leading-relaxed max-w-xs">
                <MapPin size={14} className="inline mr-2 relative -top-[1px]" />
                {settings.address}
              </p>
            )}
          </div>

          {/* Contacto */}
          <div className="text-left md:text-right flex flex-col items-start md:items-end">
            <h4 className="text-white font-bold tracking-[0.2em] uppercase text-xs mb-6">Contacto</h4>
            <ul className="space-y-4 font-light text-sm">
              {settings?.contact_email && (
                <li className="flex items-center justify-start md:justify-end gap-3 hover:text-white transition-colors">
                  <Mail size={16} className="shrink-0" /> {settings.contact_email}
                </li>
              )}
              {settings?.contact_instagram && (
                <li className="flex items-center justify-start md:justify-end gap-3 hover:text-white transition-colors">
                  <Instagram size={16} className="shrink-0" /> {settings.contact_instagram}
                </li>
              )}
              <li className="flex items-center justify-start md:justify-end gap-3 hover:text-white transition-colors">
                <Phone size={16} className="shrink-0" /> {settings?.contact_phone || "+54 (000) 000-0000"}
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 mt-16 pt-8 border-t border-slate-800/50 text-xs font-light flex justify-between items-center text-slate-600">
          <p>&copy; {new Date().getFullYear()} {settings?.name || "El Refugio"}. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
