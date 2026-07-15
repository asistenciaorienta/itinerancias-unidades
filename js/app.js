function $(id) {
  return document.getElementById(id);
}

function mostrarMsg(texto, error = false) {
  const msg = $("msg");
  if (!msg) return;
  msg.textContent = texto || "";
  msg.className = error ? "msg error" : "msg ok";
}

function normalizarTexto(v = "") {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .trim();
}

function entidadesCoinciden(a, b) {
  const na = normalizarTexto(a);
  const nb = normalizarTexto(b);

  if (!na || !nb) return false;

  return na === nb || na.includes(nb) || nb.includes(na);
}

async function obtenerSesion() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function exigirLogin() {
  const session = await obtenerSesion();

  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  return session;
}

async function obtenerConvocatoriaVigente() {
  const { data, error } = await supabaseClient
    .from("convocatorias_orienta")
    .select("id,nombre,periodo,fecha_inicio,fecha_fin,estado,visible_web")
    .eq("visible_web", true)
    .eq("estado", "VIGENTE")
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error("No hay ninguna convocatoria vigente disponible.");
  }

  return data;
}

async function obtenerPerfil() {
  const session = await exigirLogin();
  if (!session) return null;

  const { data, error } = await supabaseClient
    .from("usuarios_perfiles")
    .select("id,email,nombre,rol,unidad_id,activo,unidades(nombre)")
    .eq("id", session.user.id)
    .single();

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido cargar tu perfil. Contacta con Dirección Provincial.", true);
    return null;
  }

  if (!data.activo) {
    mostrarMsg("Tu usuario no está activo. Contacta con Dirección Provincial.", true);
    await supabaseClient.auth.signOut();
    return null;
  }

  return data;
}

async function login(email, password) {
  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    mostrarMsg("No se ha podido iniciar sesión: " + error.message, true);
    return;
  }

  window.location.href = "panel.html";
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}

async function solicitarAcceso(payload) {
  try {
    const convocatoria = await obtenerConvocatoriaVigente();
    payload.convocatoria_id = convocatoria.id;
  } catch (err) {
    console.error(err);
    mostrarMsg("No se ha podido detectar la convocatoria vigente. Inténtalo más tarde.", true);
    return;
  }

  const { error } = await supabaseClient
    .from("solicitudes_acceso")
    .insert(payload);

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido enviar la solicitud: " + error.message, true);
    return;
  }

  mostrarMsg("Solicitud enviada correctamente. Dirección Provincial la revisará.");
  const form = $("formSolicitudAcceso");
  if (form) form.reset();
}

async function cargarItineranciasPublicadasEntidad(convocatoriaId, unidadNombre) {
  const { data, error } = await supabaseClient
    .from("itinerancias_publicadas")
    .select("*")
    .eq("convocatoria_id", convocatoriaId)
    .eq("activa", true)
    .order("municipio", { ascending: true })
    .order("entidad", { ascending: true });

  if (error) throw error;

  return (data || []).filter(i => entidadesCoinciden(i.entidad, unidadNombre));
}

async function cargarPropuestasEntidad(convocatoriaId) {
  const { data, error } = await supabaseClient
    .from("itinerancias_propuestas")
    .select("*")
    .eq("convocatoria_id", convocatoriaId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data || [];
}

function renderItineranciasPublicadas(lista, unidadNombre) {
  const cont = $("listaPublicadas");
  if (!cont) return;

  if (!lista.length) {
    cont.innerHTML = `
      <p class="muted">
        No se han encontrado itinerancias publicadas asociadas a ${escapeHtml(unidadNombre)}.
      </p>
    `;
    return;
  }

  cont.innerHTML = lista.map(i => `
    <article class="item">
      <div>
        <h3>${escapeHtml(i.titulo || i.entidad || "Itinerancia")}</h3>
        <p class="muted">
          ${escapeHtml(i.municipio || "")}
          ${i.dias ? " · " + escapeHtml(i.dias) : ""}
        </p>
        <p>
          ${escapeHtml(i.direccion || "")}
          ${i.telefono ? " · Tel. " + escapeHtml(i.telefono) : ""}
        </p>
        <p class="muted">
          ${escapeHtml(i.tecnico_orienta || i.contacto || "")}
          ${i.colectivo ? " · " + escapeHtml(i.colectivo) : ""}
        </p>
      </div>
      <button class="btn" onclick="crearPropuestaModificacion('${escapeHtml(i.id)}')">
        Solicitar modificación
      </button>
    </article>
  `).join("");
}

function renderPropuestas(lista) {
  const listaCont = $("listaPropuestas");
  if (!listaCont) return;

  if (!lista.length) {
    listaCont.innerHTML = `<p class="muted">Todavía no tienes propuestas para la convocatoria vigente.</p>`;
    return;
  }

  listaCont.innerHTML = lista.map(p => `
    <article class="item">
      <div>
        <h3>${escapeHtml(p.titulo || "Sin título")}</h3>
        <p class="muted">
          ${escapeHtml(p.tipo || "")} · ${escapeHtml(p.estado || "")}
        </p>
        <p>${escapeHtml(p.municipio || "")} ${p.horario ? "· " + escapeHtml(p.horario) : ""}</p>
      </div>
      <span class="estado estado-${escapeHtml(String(p.estado || "").toLowerCase())}">
        ${escapeHtml(p.estado || "")}
      </span>
    </article>
  `).join("");
}

let perfilActual = null;
let convocatoriaActual = null;
let publicadasActuales = [];

async function cargarPanel() {
  const perfil = await obtenerPerfil();
  if (!perfil) return;

  perfilActual = perfil;

  try {
    convocatoriaActual = await obtenerConvocatoriaVigente();
  } catch (err) {
    console.error(err);
    mostrarMsg("No se ha podido detectar la convocatoria vigente.", true);
    return;
  }

  const unidadNombre = perfil.unidades?.nombre || "Unidad sin asignar";

  const info = $("usuarioInfo");
  if (info) {
    info.textContent = `${perfil.nombre || perfil.email} · ${unidadNombre} · ${convocatoriaActual.nombre}`;
  }

  try {
    const [publicadas, propuestas] = await Promise.all([
      cargarItineranciasPublicadasEntidad(convocatoriaActual.id, unidadNombre),
      cargarPropuestasEntidad(convocatoriaActual.id)
    ]);

    publicadasActuales = publicadas;

    renderItineranciasPublicadas(publicadas, unidadNombre);
    renderPropuestas(propuestas);

  } catch (error) {
    console.error(error);
    mostrarMsg("No se han podido cargar los datos: " + error.message, true);
  }
}

function datosFormularioItinerancia(estado) {
  return {
    tipo: $("tipo")?.value || "NUEVA",
    estado,
    titulo: $("titulo")?.value.trim() || "",
    descripcion: $("descripcion")?.value.trim() || null,
    municipio: $("municipio")?.value.trim() || null,
    direccion: $("direccion")?.value.trim() || null,
    horario: $("horario")?.value.trim() || null,
    frecuencia: $("frecuencia")?.value.trim() || null,
    fecha_inicio: $("fechaInicio")?.value || null,
    fecha_fin: $("fechaFin")?.value || null,
    contacto: $("contacto")?.value.trim() || null,
    telefono: $("telefono")?.value.trim() || null,
    email: $("emailContacto")?.value.trim() || null,
    observaciones_publicas: $("observacionesPublicas")?.value.trim() || null,
    observaciones_unidad: $("observacionesUnidad")?.value.trim() || null
  };
}

async function guardarPropuesta(estado) {
  const perfil = await obtenerPerfil();
  if (!perfil) return;

  let convocatoria;

  try {
    convocatoria = await obtenerConvocatoriaVigente();
  } catch (err) {
    console.error(err);
    mostrarMsg("No se ha podido detectar la convocatoria vigente. No se puede guardar la propuesta.", true);
    return;
  }

  const payload = datosFormularioItinerancia(estado);

  if (!payload.titulo) {
    mostrarMsg("El título es obligatorio.", true);
    return;
  }

  payload.unidad_id = perfil.unidad_id;
  payload.creada_por = perfil.id;
  payload.convocatoria_id = convocatoria.id;

  if (estado === "PENDIENTE_VALIDACION") {
    payload.enviada_at = new Date().toISOString();
  }

  const idPropuesta = obtenerIdPropuestaEdicion();

  let error;

  if (idPropuesta) {
    const res = await supabaseClient
      .from("itinerancias_propuestas")
      .update(payload)
      .eq("id", idPropuesta);

    error = res.error;
  } else {
    const res = await supabaseClient
      .from("itinerancias_propuestas")
      .insert(payload);

    error = res.error;
  }

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido guardar la propuesta: " + error.message, true);
    return;
  }

  mostrarMsg(
    estado === "BORRADOR"
      ? "Borrador guardado correctamente."
      : "Propuesta enviada a validación correctamente."
  );

  setTimeout(() => {
    window.location.href = "panel.html";
  }, 900);
}

async function crearPropuestaModificacion(idPublicada) {
  if (!perfilActual || !convocatoriaActual) {
    mostrarMsg("No se ha podido cargar tu perfil o la convocatoria.", true);
    return;
  }

  const original = publicadasActuales.find(i => String(i.id) === String(idPublicada));

  if (!original) {
    mostrarMsg("No se ha encontrado la itinerancia seleccionada.", true);
    return;
  }

  const payload = {
    tipo: "MODIFICACION",
    estado: "BORRADOR",
    titulo: original.titulo || original.entidad || "Modificación de itinerancia",
    descripcion: original.descripcion || null,
    municipio: original.municipio || null,
    direccion: original.direccion || null,
    horario: original.horario || original.dias || null,
    frecuencia: original.frecuencia || original.dias || null,
    fecha_inicio: original.fecha_inicio || null,
    fecha_fin: original.fecha_fin || null,
    contacto: original.contacto || original.tecnico_orienta || null,
    telefono: original.telefono || null,
    email: original.email || null,
    observaciones_publicas: original.observaciones_publicas || null,
    observaciones_unidad: "Propuesta creada a partir de una itinerancia publicada para solicitar modificación.",
    unidad_id: perfilActual.unidad_id,
    creada_por: perfilActual.id,
    convocatoria_id: convocatoriaActual.id
  };

  const { data, error } = await supabaseClient
    .from("itinerancias_propuestas")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido crear la propuesta de modificación: " + error.message, true);
    return;
  }

  window.location.href = `nueva-itinerancia.html?propuesta=${encodeURIComponent(data.id)}`;
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

function obtenerIdPropuestaEdicion() {
  const params = new URLSearchParams(window.location.search);
  return params.get("propuesta");
}

function setValor(id, valor) {
  const el = $(id);
  if (el) el.value = valor ?? "";
}

async function cargarPropuestaParaEditar() {
  const idPropuesta = obtenerIdPropuestaEdicion();
  if (!idPropuesta || !$("formNuevaItinerancia")) return;

  const perfil = await obtenerPerfil();
  if (!perfil) return;

  const { data, error } = await supabaseClient
    .from("itinerancias_propuestas")
    .select("*")
    .eq("id", idPropuesta)
    .maybeSingle();

  if (error) {
    console.error(error);
    mostrarMsg("No se ha podido cargar la propuesta para editar.", true);
    return;
  }

  if (!data) {
    mostrarMsg("No se ha encontrado la propuesta.", true);
    return;
  }

  if (!["BORRADOR", "RECHAZADA"].includes(String(data.estado || ""))) {
    mostrarMsg("Esta propuesta ya no se puede editar porque está enviada o publicada.", true);
    return;
  }

  setValor("tipo", data.tipo || "MODIFICACION");
  setValor("titulo", data.titulo);
  setValor("descripcion", data.descripcion);
  setValor("municipio", data.municipio);
  setValor("direccion", data.direccion);
  setValor("horario", data.horario);
  setValor("frecuencia", data.frecuencia);
  setValor("fechaInicio", data.fecha_inicio);
  setValor("fechaFin", data.fecha_fin);
  setValor("contacto", data.contacto);
  setValor("telefono", data.telefono);
  setValor("emailContacto", data.email);
  setValor("observacionesPublicas", data.observaciones_publicas);
  setValor("observacionesUnidad", data.observaciones_unidad);

  const h1 = document.querySelector("h1");
  if (h1) h1.textContent = "Editar propuesta de itinerancia";

  mostrarMsg("Editando borrador de modificación.");
}

document.addEventListener("DOMContentLoaded", () => {
  cargarPropuestaParaEditar();
  
  const formLogin = $("formLogin");
  if (formLogin) {
    formLogin.addEventListener("submit", async e => {
      e.preventDefault();
      await login($("loginEmail").value.trim(), $("loginPassword").value);
    });
  }

  const formSolicitud = $("formSolicitudAcceso");
  if (formSolicitud) {
    formSolicitud.addEventListener("submit", async e => {
      e.preventDefault();

      await solicitarAcceso({
        nombre: $("solNombre").value.trim(),
        email: $("solEmail").value.trim(),
        telefono: $("solTelefono").value.trim() || null,
        unidad_nombre: $("solUnidad").value.trim(),
        cargo: $("solCargo").value.trim() || null,
        observaciones: $("solObservaciones").value.trim() || null,
        estado: "PENDIENTE"
      });
    });
  }

  const btnLogout = $("btnLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", logout);
  }

  if ($("listaPropuestas")) {
    cargarPanel();
  }

  const formNueva = $("formNuevaItinerancia");
  if (formNueva) {
    formNueva.addEventListener("submit", async e => {
      e.preventDefault();
      await guardarPropuesta("PENDIENTE_VALIDACION");
    });
  }

  const btnGuardarBorrador = $("btnGuardarBorrador");
  if (btnGuardarBorrador) {
    btnGuardarBorrador.addEventListener("click", async () => {
      await guardarPropuesta("BORRADOR");
    });
  }
});
