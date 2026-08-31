using System;
using System.Collections.Generic;
using System.IO;
using System.Management;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace Rentfoxxy.HwCapture
{
    /// <summary>
    /// Per-session hardware capture stub. Session config is appended after the PE:
    ///   [stub.exe bytes][json utf8][uint32 le length][magic "RFXYHW01"]
    /// </summary>
    internal static class Program
    {
        private const string Magic = "RFXYHW01";

        private sealed class SessionConfig
        {
            public string apiBase;
            public string token;
            public string apiPrefix;
            public string brand;
        }

        private sealed class HwConfig
        {
            public string manufacturer;
            public string model;
            public string model_version;
            public string system_family;
            public string processor;
            public string generation;
            public int ram;
            public int ssd;
            public string gpu;
        }

        [STAThread]
        private static int Main()
        {
            Console.Title = "Rentfoxxy Hardware Capture";
            try
            {
                SessionConfig session = LoadSessionFromSelf();
                if (session == null)
                {
                    Fail("This EXE has no session data. Download it again from the CRM capture page after entering the access number.");
                    return 1;
                }

                string brand = string.IsNullOrEmpty(session.brand) ? "Hardware" : session.brand;
                Console.WriteLine("Rentfoxxy " + brand + " — hardware verification");
                Console.WriteLine("Reading local hardware...");

                HwConfig hw = ReadHardware();
                Console.WriteLine("  Brand/Mfr : " + hw.manufacturer);
                Console.WriteLine("  Model     : " + hw.model);
                Console.WriteLine("  Processor : " + hw.processor);
                Console.WriteLine("  Generation: " + hw.generation);
                Console.WriteLine("  RAM (GB)  : " + hw.ram);
                Console.WriteLine("  SSD (GB)  : " + hw.ssd);
                Console.WriteLine("  GPU       : " + hw.gpu);
                Console.WriteLine();

                string apiBase = (session.apiBase ?? "").TrimEnd('/');
                string prefix = (session.apiPrefix ?? "").Trim('/');
                string token = session.token ?? "";
                if (apiBase.Length == 0 || prefix.Length == 0 || token.Length == 0)
                {
                    Fail("Session config is incomplete (apiBase / apiPrefix / token).");
                    return 1;
                }

                string verifyUrl = apiBase + "/" + prefix + "/" + token + "/verify-configuration";
                string serialUrl = apiBase + "/" + prefix + "/" + token;

                Console.WriteLine("Verifying against CRM...");
                string verifyJson = PostJson(verifyUrl, ToJson(hw));
                if (verifyJson == null)
                {
                    Fail("Verify request failed. Generate a new access number on the QC2 screen, download a fresh Windows app, and run it on this laptop.");
                    return 1;
                }

                bool matched = JsonBool(verifyJson, "configurationMatched");
                if (!matched)
                {
                    string serverMsg = JsonString(verifyJson, "message");
                    Console.ForegroundColor = ConsoleColor.Red;
                    if (!string.IsNullOrEmpty(serverMsg))
                        Console.WriteLine(serverMsg);
                    else
                        Console.WriteLine("Configuration does NOT match:");
                    PrintErrors(verifyJson);
                    Console.ResetColor();
                    Pause();
                    return 2;
                }

                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("Configuration matched.");
                Console.ResetColor();

                string serial = ReadBiosSerial();
                if (string.IsNullOrEmpty(serial))
                {
                    Fail("Could not read BIOS serial number.");
                    return 1;
                }

                string serialBody = "{\"serial_number\":\"" + EscapeJson(serial) + "\"}";
                string serialResp = PostJson(serialUrl, serialBody);
                if (serialResp == null)
                {
                    Fail("Serial submit failed.");
                    return 1;
                }

                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("Verified + serial sent: " + serial);
                Console.WriteLine("Done! Return to the CRM — testing unlocks automatically.");
                Console.ResetColor();
                Pause();
                return 0;
            }
            catch (Exception ex)
            {
                Fail(ex.Message);
                return 1;
            }
        }

        private static SessionConfig LoadSessionFromSelf()
        {
            string path = System.Reflection.Assembly.GetExecutingAssembly().Location;
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
                path = Environment.GetCommandLineArgs()[0];

            byte[] bytes = File.ReadAllBytes(path);
            if (bytes.Length < 12)
                return null;

            int magicLen = Magic.Length;
            for (int i = 0; i < magicLen; i++)
            {
                if (bytes[bytes.Length - magicLen + i] != (byte)Magic[i])
                    return null;
            }

            int lenOffset = bytes.Length - magicLen - 4;
            uint jsonLen = BitConverter.ToUInt32(bytes, lenOffset);
            if (jsonLen == 0 || jsonLen > 64 * 1024)
                return null;
            int jsonStart = lenOffset - (int)jsonLen;
            if (jsonStart < 0)
                return null;

            string json = Encoding.UTF8.GetString(bytes, jsonStart, (int)jsonLen);
            SessionConfig cfg = new SessionConfig();
            cfg.apiBase = JsonString(json, "apiBase");
            cfg.token = JsonString(json, "token");
            cfg.apiPrefix = JsonString(json, "apiPrefix");
            cfg.brand = JsonString(json, "brand");
            return cfg;
        }

        private static string JsonString(string json, string key)
        {
            Match m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
            if (!m.Success) return "";
            return UnescapeJson(m.Groups[1].Value);
        }

        private static string ExtractJsonMessage(string body)
        {
            if (string.IsNullOrEmpty(body)) return "";
            return JsonString(body, "message");
        }

        private static string UnescapeJson(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\\"", "\"").Replace("\\\\", "\\").Replace("\\n", "\n").Replace("\\r", "\r");
        }

        private static HwConfig ReadHardware()
        {
            HwConfig cfg = new HwConfig();

            ManagementObject cs = First("SELECT Manufacturer, Model, SystemFamily, TotalPhysicalMemory FROM Win32_ComputerSystem");
            if (cs != null)
            {
                cfg.manufacturer = Str(cs["Manufacturer"]);
                cfg.model = Str(cs["Model"]);
                cfg.system_family = Str(cs["SystemFamily"]);
            }

            ManagementObject csp = First("SELECT Version FROM Win32_ComputerSystemProduct");
            if (csp != null)
                cfg.model_version = Str(csp["Version"]);

            ManagementObject cpu = First("SELECT Name FROM Win32_Processor");
            if (cpu != null)
                cfg.processor = Str(cpu["Name"]);

            ManagementObject gpu = First("SELECT Name FROM Win32_VideoController");
            if (gpu != null)
                cfg.gpu = Str(gpu["Name"]);

            long ramBytes = 0;
            foreach (ManagementObject mo in Query("SELECT Capacity FROM Win32_PhysicalMemory"))
            {
                ramBytes += ToLong(mo["Capacity"]);
            }
            if (ramBytes <= 0 && cs != null)
                ramBytes = ToLong(cs["TotalPhysicalMemory"]);
            cfg.ram = (int)Math.Round(ramBytes / (1024.0 * 1024.0 * 1024.0));

            long diskBytes = 0;
            try
            {
                foreach (ManagementObject mo in Query("SELECT Size FROM Win32_DiskDrive"))
                {
                    long sz = ToLong(mo["Size"]);
                    if (sz > diskBytes) diskBytes = sz;
                }
            }
            catch
            {
            }
            if (diskBytes <= 0)
            {
                foreach (ManagementObject mo in Query("SELECT Size FROM Win32_LogicalDisk WHERE DriveType=3"))
                {
                    diskBytes += ToLong(mo["Size"]);
                }
            }
            cfg.ssd = (int)Math.Round(diskBytes / 1000000000.0);

            cfg.generation = ParseGeneration(cfg.processor);
            return cfg;
        }

        private static string ReadBiosSerial()
        {
            ManagementObject bios = First("SELECT SerialNumber FROM Win32_BIOS");
            if (bios == null) return "";
            return Str(bios["SerialNumber"]).Trim().ToUpperInvariant();
        }

        private static string ParseGeneration(string cpu)
        {
            if (string.IsNullOrEmpty(cpu)) return "";
            Match m = Regex.Match(cpu, @"(\d{1,2})(?:st|nd|rd|th)\s*Gen", RegexOptions.IgnoreCase);
            if (m.Success) return m.Groups[1].Value;

            m = Regex.Match(cpu, @"i[3579][- ]?(\d{3,5})", RegexOptions.IgnoreCase);
            if (!m.Success) return "";
            string n = m.Groups[1].Value;
            if (n.Length >= 5) return n.Substring(0, 2);
            if (n.Length == 4)
            {
                if (n.Substring(0, 1) == "1") return n.Substring(0, 2);
                return n.Substring(0, 1);
            }
            return n.Substring(0, 1);
        }

        private static ManagementObject First(string wql)
        {
            List<ManagementObject> list = Query(wql);
            return list.Count > 0 ? list[0] : null;
        }

        private static List<ManagementObject> Query(string wql)
        {
            List<ManagementObject> list = new List<ManagementObject>();
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(wql))
            {
                foreach (ManagementObject mo in searcher.Get())
                    list.Add(mo);
            }
            return list;
        }

        private static string Str(object o)
        {
            return o == null ? "" : Convert.ToString(o).Trim();
        }

        private static long ToLong(object o)
        {
            if (o == null || o == DBNull.Value) return 0;
            try { return Convert.ToInt64(o); }
            catch { return 0; }
        }

        private static string PostJson(string url, string jsonBody)
        {
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)768 | SecurityProtocolType.Tls;
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 60000;
                byte[] data = Encoding.UTF8.GetBytes(jsonBody);
                req.ContentLength = data.Length;
                using (Stream s = req.GetRequestStream())
                {
                    s.Write(data, 0, data.Length);
                }
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
            catch (WebException wex)
            {
                string body = "";
                try
                {
                    if (wex.Response != null)
                    {
                        using (StreamReader reader = new StreamReader(wex.Response.GetResponseStream(), Encoding.UTF8))
                            body = reader.ReadToEnd();
                    }
                }
                catch { }
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("HTTP error: " + wex.Message);
                if (!string.IsNullOrEmpty(body))
                {
                    string msg = ExtractJsonMessage(body);
                    if (!string.IsNullOrEmpty(msg))
                        Console.WriteLine(msg);
                    else
                        Console.WriteLine(body);
                }
                Console.ResetColor();
                return null;
            }
        }

        private static string ToJson(HwConfig hw)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"manufacturer\":\"").Append(EscapeJson(hw.manufacturer)).Append("\",");
            sb.Append("\"model\":\"").Append(EscapeJson(hw.model)).Append("\",");
            sb.Append("\"model_version\":\"").Append(EscapeJson(hw.model_version)).Append("\",");
            sb.Append("\"system_family\":\"").Append(EscapeJson(hw.system_family)).Append("\",");
            sb.Append("\"processor\":\"").Append(EscapeJson(hw.processor)).Append("\",");
            sb.Append("\"generation\":\"").Append(EscapeJson(hw.generation)).Append("\",");
            sb.Append("\"ram\":").Append(hw.ram).Append(",");
            sb.Append("\"ssd\":").Append(hw.ssd).Append(",");
            sb.Append("\"gpu\":\"").Append(EscapeJson(hw.gpu)).Append("\"");
            sb.Append("}");
            return sb.ToString();
        }

        private static string EscapeJson(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
        }

        private static bool JsonBool(string json, string key)
        {
            Match m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(true|false)", RegexOptions.IgnoreCase);
            if (!m.Success) return false;
            return string.Equals(m.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase);
        }

        private static void PrintErrors(string json)
        {
            MatchCollection fields = Regex.Matches(json,
                "\"field\"\\s*:\\s*\"([^\"]*)\"[\\s\\S]*?\"expected\"\\s*:\\s*\"([^\"]*)\"[\\s\\S]*?\"actual\"\\s*:\\s*\"([^\"]*)\"",
                RegexOptions.IgnoreCase);
            if (fields.Count == 0)
            {
                Console.WriteLine(json);
                return;
            }
            foreach (Match m in fields)
            {
                Console.WriteLine("  - " + m.Groups[1].Value + ": expected '" + m.Groups[2].Value + "', found '" + m.Groups[3].Value + "'");
            }
        }

        private static void Fail(string message)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine(message);
            Console.ResetColor();
            Pause();
        }

        private static void Pause()
        {
            Console.WriteLine();
            Console.Write("Press Enter to close...");
            try { Console.ReadLine(); }
            catch { }
        }
    }
}
