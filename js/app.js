function $(id) {
  return document.getElementById(id);
}

function mostrarMsg(texto, error = false) {
  const msg = $("msg");
  if (!msg) return;
  msg.textContent = texto || "";
  msg.className = error ? "msg error" : "msg ok";
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

  if (error) {
    console.error(error);
    throw error;
  }

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

async function cargarPanel() {
  const perfil = await obtenerPerfil();
  if (!perfil) return;

  let convocatoria = null;

  try {
    convocatoria = await obtenerConvocatoriaVigente();
  } catch (err) {
    console.error(err);
    mostrarMsg("No se ha podido detectar la convocatoria vigente.", true);
  }

  const unidadNombre = perfil.unidades?.nombre || "Unidad sin asignar";

  const info = $("usuarioInfo");
  if (info) {
    const convocatoriaTxt = convocatoria?.nombre ? ` · ${convocatoria.nombre}` : "";
    info.textContent = `${perfil.nombre || perfil.email} · ${unidadNombre}${convocatoriaTxt}`;
  }

  let query = supabaseClient
    .from("itinerancias_propuestas")
    .select("*")
    .order("created_at", { ascending: false });

  if (convocatoria?.id) {
    query = query.eq("convocatoria_id", convocatoria.id);
  }

  const { data, error } = await query;

  const lista = $("listaPropuestas");

  if (error) {
    console.error(error);
    if (lista) lista.innerHTML = "";
    mostrarMsg("No se han podido cargar tus propuestas: " + error.message, true);
    return;
  }

  if (!lista) return;

  if (!data.length) {
    lista.innerHTML = `<p class="muted">Todavía no tienes propuestas para la convocatoria vigente.</p>`;
    return;
  }

  lista.innerHTML = data.map(p => `
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

  const { error } = await supabaseClient
    .from("itinerancias_propuestas")
    .insert(payload);

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

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

document.addEventListener("DOMContentLoaded", () => {
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
