"""
Testes de interface ponta a ponta (Playwright + Chrome), com backend SIMULADO.
Executar a partir da raiz do projeto:  python3 tests/e2e/testar_interface.py [pasta_capturas]
"""
import http.server
import json
import os
import socketserver
import sys
import threading
from functools import partial

from playwright.sync_api import sync_playwright, expect

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
AQUI = os.path.dirname(os.path.abspath(__file__))
CAPTURAS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(AQUI, "capturas")
os.makedirs(CAPTURAS, exist_ok=True)
PORTA = 8765
BASE = f"http://localhost:{PORTA}"

CONFIG_TESTE = 'export const CONFIG = { SUPABASE_URL: "https://teste.supabase.co", SUPABASE_ANON_KEY: "chave-publica-de-teste" };'


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def servidor():
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORTA), partial(Silencioso, directory=RAIZ))
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def preparar(ctx, erros):
    ler = lambda n: open(os.path.join(AQUI, n), encoding="utf-8").read()
    ctx.route("**/assets/js/config.js", lambda r: r.fulfill(body=CONFIG_TESTE, content_type="text/javascript"))
    ctx.route("https://cdn.jsdelivr.net/npm/@supabase/**", lambda r: r.fulfill(body=ler("mock-supabase.js"), content_type="text/javascript"))
    ctx.route("https://cdn.jsdelivr.net/npm/chart.js**", lambda r: r.fulfill(body=ler("stubs.js"), content_type="text/javascript"))
    ctx.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    ctx.route("https://fonts.gstatic.com/**", lambda r: r.abort())


def nova_pagina(ctx, erros, nome):
    p = ctx.new_page()
    p.on("console", lambda m: m.type == "error" and erros.append(f"[{nome}] console: {m.text}"))
    p.on("pageerror", lambda e: erros.append(f"[{nome}] pageerror: {e}"))
    return p


def entrar(p, email, senha="senha12345"):
    p.goto(f"{BASE}/index.html")
    p.fill("#form-login [name=email]", email)
    p.fill("#form-login [name=senha]", senha)
    p.click("#btn-entrar")


def sair(p):
    p.click("#btn-sair")
    p.wait_for_url("**/index.html")


def itens_menu(p):
    return p.locator(".nav a").all_inner_texts()


def main():
    srv = servidor()
    erros, ok = [], []
    passo = lambda t: (ok.append(t), print("  ✓", t))
    with sync_playwright() as pw:
        nav = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = nav.new_context(viewport={"width": 1440, "height": 900}, locale="pt-BR", timezone_id="America/Sao_Paulo", accept_downloads=True)
        preparar(ctx, erros)
        p = nova_pagina(ctx, erros, "desktop")

        # ---------- Login ----------
        p.goto(f"{BASE}/index.html")
        p.screenshot(path=f"{CAPTURAS}/01-login.png")
        entrar(p, "prof@teste.local", "errada")
        expect(p.locator("#mensagem")).to_contain_text("E-mail ou senha incorretos")
        passo("senha errada é recusada")
        entrar(p, "inativo@teste.local")
        expect(p.locator("#mensagem")).to_contain_text("não foi liberado")
        passo("usuário inativo é bloqueado")
        p.goto(f"{BASE}/app.html#/dashboard")
        p.wait_for_url("**/index.html")
        passo("rota protegida sem sessão volta ao login")

        # ---------- Profissional ----------
        entrar(p, "prof@teste.local")
        p.wait_for_url("**/app.html#/novo-atendimento")
        assert itens_menu(p) == ["Novo atendimento", "Fluxograma de encaminhamento", "Histórico de pacientes"], itens_menu(p)
        passo("profissional vê só o menu permitido e cai em Novo atendimento")
        p.goto(f"{BASE}/app.html#/configuracoes")
        p.wait_for_url("**#/novo-atendimento")
        passo("profissional não acessa Configurações pela URL")

        p.fill("[name=relato]", "Tô com dor no peito desde ontem")
        expect(p.locator(".alerta-critico")).to_be_visible()
        expect(p.locator(".alerta-critico")).to_contain_text("Dor torácica")
        passo("alerta de dor torácica aparece antes da IA")
        p.screenshot(path=f"{CAPTURAS}/02-alerta.png", full_page=True)
        p.click("#btn-interpretar")
        expect(p.locator("#bloco-interp")).to_contain_text("Regras locais (sem IA)")
        expect(p.locator("#bloco-interp")).to_contain_text("IA indisponível")
        expect(p.locator("#bloco-interp")).to_contain_text("Avaliação imediata")
        expect(p.locator("#d-EMERGENCIA")).to_be_checked()
        passo("sem IA configurada usa regras locais, identificadas como tais")
        p.check("#d-UPA", force=True)
        expect(p.locator("#campo-just")).to_be_visible()
        p.click("#btn-salvar")
        expect(p.locator(".toast.erro").last).to_contain_text("justificativa")
        p.fill("[name=justificativa]", "Paciente já em observação na própria UPA, estável.")
        p.screenshot(path=f"{CAPTURAS}/03-atendimento.png", full_page=True)
        p.click("#btn-salvar")
        expect(p.locator("#sucesso")).to_contain_text("Atendimento nº 1 registrado")
        passo("divergência exige justificativa; atendimento nº 1 salvo")

        p.evaluate("""() => { const d = JSON.parse(localStorage.__mock_db__); d._modoIA = 'ligada'; localStorage.__mock_db__ = JSON.stringify(d); }""")
        p.click("#btn-novo")
        p.fill("[name=relato]", "paciente com gripe e dor de garganta, sem falta de ar")
        expect(p.locator(".aviso-atencao")).to_contain_text("negação")
        p.click("#btn-interpretar")
        expect(p.locator("#bloco-interp .tag-ia")).to_contain_text("gemini-teste")
        expect(p.locator("#bloco-interp")).to_contain_text("descartados")
        expect(p.locator("#d-UBS")).to_be_checked()
        p.fill("[name=relato]", "paciente com gripe e dor de garganta, sem falta de ar!!")
        expect(p.locator("#aviso-desatualizado")).to_be_visible()
        expect(p.locator("#btn-salvar")).to_be_disabled()
        passo("relato alterado após interpretação bloqueia o salvamento")
        p.click("#btn-interpretar")
        expect(p.locator("#btn-salvar")).to_be_enabled()
        p.select_option("[name=resultado]", "atendido_no_destino")
        p.click("#btn-salvar")
        expect(p.locator("#sucesso")).to_contain_text("nº 2")
        passo("interpretação por IA integrada à recomendação (UPA → UBS) e salva")

        p.click("text=Ver no fluxograma")
        expect(p.locator("#rastreio")).to_contain_text("Destino escolhido")
        expect(p.locator(".fluxo-caixa.ativa")).to_have_count(5)
        p.screenshot(path=f"{CAPTURAS}/04-fluxograma.png", full_page=True)
        passo("fluxograma rastreia o atendimento nas 5 etapas")

        p.click("text=Histórico de pacientes")
        expect(p.locator("#tabela tbody tr")).to_have_count(2)
        p.locator("#tabela tbody tr").first.click()
        p.select_option("#novo-resultado", "reencaminhado")
        p.click(".modal-rodape >> text=Salvar resultado")
        expect(p.locator(".toast").last).to_contain_text("Resultado atualizado")
        p.locator("#tabela tbody tr").first.click()
        expect(p.locator("#hist")).to_contain_text("Atendido no destino → Reencaminhado")
        p.screenshot(path=f"{CAPTURAS}/05-historico.png")
        p.keyboard.press("Escape")
        passo("resultado atualizado com histórico de auditoria")
        sair(p)

        # ---------- Gestor ----------
        entrar(p, "gestor@teste.local")
        p.wait_for_url("**#/dashboard")
        assert "Novo atendimento" not in itens_menu(p) and "Usuários" not in itens_menu(p)
        expect(p.locator(".kpi").first).to_contain_text("2")
        p.wait_for_function("window.__graficos.length >= 4")
        p.screenshot(path=f"{CAPTURAS}/06-dashboard.png", full_page=True)
        graficos = p.evaluate("window.__graficos")
        passo(f"dashboard do gestor com indicadores e {len(graficos)} gráficos")
        for b in ["Dia", "Semana", "Ano"]:
            p.click(f"[data-periodo] >> text={b}")
            p.wait_for_selector(".kpi")
        passo("filtros de dia/semana/ano funcionam")
        p.click("text=Economia gerada")
        expect(p.locator(".kpi.destaque")).to_contain_text("R$")
        expect(p.locator("#painel")).to_contain_text("Sem dados de economia comprovada")
        p.screenshot(path=f"{CAPTURAS}/07-economia.png", full_page=True)
        passo("economia potencial separada da comprovada")
        p.click("text=Otimização da rede")
        expect(p.locator("#painel")).to_contain_text("Origem × destino")
        p.screenshot(path=f"{CAPTURAS}/08-otimizacao.png", full_page=True)
        p.click("text=Relatórios")
        expect(p.locator("#relatorio")).to_contain_text("Relatório mensal")
        with p.expect_download() as dl:
            p.click("#exp-csv")
        caminho = dl.value.path()
        conteudo = open(caminho, encoding="utf-8-sig").read()
        assert "Destino escolhido" in conteudo and "dor de garganta" not in conteudo, conteudo[:300]
        p.screenshot(path=f"{CAPTURAS}/09-relatorio.png", full_page=True)
        passo("relatório mensal e CSV sem relato livre (LGPD)")
        sair(p)

        # ---------- Administrador ----------
        entrar(p, "admin@teste.local")
        p.wait_for_url("**#/dashboard")
        assert len(itens_menu(p)) == 9, itens_menu(p)
        passo("administrador vê os 9 itens do menu")
        p.click("text=Configurações")
        p.fill("[name=custo_hospital]", "450")
        p.click("text=Salvar configurações")
        expect(p.locator(".toast").last).to_contain_text("Configurações salvas")
        for aba in ["Unidades de saúde", "Regras de encaminhamento", "Linha de base", "Auditoria"]:
            p.click(f"[data-aba] >> text={aba}")
            p.wait_for_selector("#aba .card")
        p.click("[data-aba] >> text=Linha de base")
        p.fill("#nova-base [name=competencia]", "2025-01")
        p.fill("#nova-base [name=atendimentos]", "1200")
        p.fill("#nova-base [name=fonte]", "Teste automatizado")
        p.click("#nova-base button[type=submit]")
        expect(p.locator("#aba tbody tr")).to_have_count(1)
        passo("configurações, unidades, regras, linha de base e auditoria")
        p.click("text=Usuários")
        p.click("#btn-novo-usuario")
        p.fill(".modal [name=nome]", "Novo Profissional")
        p.fill(".modal [name=email]", "novo@teste.local")
        p.fill(".modal [name=senha]", "senhaTemporaria1")
        p.click(".modal-rodape >> text=Criar usuário")
        expect(p.locator("#lista")).to_contain_text("Novo Profissional")
        p.screenshot(path=f"{CAPTURAS}/10-usuarios.png")
        passo("administrador cria usuário")

        # ---------- Celular ----------
        cel = nav.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, locale="pt-BR")
        preparar(cel, erros)
        m = nova_pagina(cel, erros, "celular")
        m.goto(f"{BASE}/index.html")
        banco = json.loads(p.evaluate("localStorage.__mock_db__"))
        banco["_sessao"] = None
        m.evaluate("b => { localStorage.__mock_db__ = b }", json.dumps(banco))
        m.reload()
        m.screenshot(path=f"{CAPTURAS}/11-login-celular.png")
        entrar(m, "gestor@teste.local")
        m.wait_for_url("**#/dashboard")
        m.wait_for_selector(".kpi")
        largura = m.evaluate("document.documentElement.scrollWidth")
        assert largura <= 390, f"rolagem horizontal no celular: {largura}px"
        m.screenshot(path=f"{CAPTURAS}/12-dashboard-celular.png", full_page=True)
        m.click("#btn-menu")
        m.screenshot(path=f"{CAPTURAS}/13-menu-celular.png")
        passo("layout responsivo no celular, sem rolagem horizontal")

        # ---------- Orientação ao cidadão (página original) ----------
        c = nova_pagina(ctx, erros, "consulta")
        c.goto(f"{BASE}/consulta.html")
        c.fill("#symptom", "Gripe")
        c.click("text=Verificar")
        c.wait_for_url("**/UBS.html")
        c.goto(f"{BASE}/consulta.html")
        c.fill("#symptom", "estou com falta de ar")
        c.click("text=Verificar")
        expect(c.locator(".emergencia")).to_contain_text("192")
        c.screenshot(path=f"{CAPTURAS}/14-consulta.png", full_page=True)
        passo("página pública original mantida (Gripe → UBS) e com alerta de emergência")

        nav.close()
    srv.shutdown()
    reais = [e for e in erros if "favicon" not in e and "ERR_FAILED" not in e]
    if reais:
        print("\nERROS DE CONSOLE:")
        for e in reais:
            print("  ✗", e)
        sys.exit(1)
    print(f"\n{len(ok)} verificações de interface passaram, sem erros de console.")


if __name__ == "__main__":
    main()
