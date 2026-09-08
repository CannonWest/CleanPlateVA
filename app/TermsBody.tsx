/**
 * The Terms of Use and Data Acknowledgment — the ONE source (C2). Cannon's
 * words verbatim (approved 2026-08-17; typographic quotes intact), with
 * the real attribution hrefs (D-ACK-2 rides here). About §05 mounts this
 * inside `#aboutTermsBody`; the acknowledgement dialog mounts the SAME
 * component in its scroll box — one module, two mounts, so the page and
 * the dialog cannot drift (the React form of the old DOM clone).
 */

import { AGGREGATE_TENANT, FAIRFAX_RECORDS_URL, PORTAL_BASE } from './constants'

const PORTAL_URL = `${PORTAL_BASE}/${AGGREGATE_TENANT}`

export function TermsBody() {
    return (
        <div className="[&_a]:text-cp-accent [&_a:hover]:underline [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-cp-12.5 [&_h3]:font-bold [&_h3:first-child]:mt-0 [&_li]:mb-1 [&_li]:text-cp-12.5 [&_li]:leading-normal [&_li]:text-cp-ink-2 [&_p]:mb-2 [&_p]:text-cp-12.5 [&_p]:leading-normal [&_p]:text-cp-ink-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-4.5">
            <h3>Inspection Records and Source Data</h3>
            <p>CleanPlateVA collects, organizes, and presents publicly available food establishment inspection records published by two agencies: the Virginia Department of Health, through <a href={PORTAL_URL} target="_blank" rel="noopener">MyHealthDepartment</a>, for localities served by VDH health districts; and the Fairfax County Health Department, through its <a href={FAIRFAX_RECORDS_URL} target="_blank" rel="noopener">Food Establishment Inspection Reports</a> system, for the Fairfax localities it serves.</p>
            <p>CleanPlateVA is an independent service and is not affiliated with, operated by, or endorsed by the Virginia Department of Health, MyHealthDepartment, or the Fairfax County Health Department.</p>
            <p>Inspection information displayed on this site is an archived snapshot and may not reflect the most recent information available from the responsible health department. The original inspection record published by that department remains the authoritative source. Users should consult the source record when current or official information is required.</p>
            <h3>CleanPlateVA Scores and Grades</h3>
            <p>Scores, letter grades, compliance percentages, trends, flags, classifications, and other summaries displayed by CleanPlateVA are calculated by CleanPlateVA from the underlying inspection records.</p>
            <p>These calculations are not issued or approved by the Virginia Department of Health or the Fairfax County Health Department and should not be interpreted as official restaurant grades, food safety certifications, health-risk assessments, or predictions of whether a person will become ill.</p>
            <p>The Fairfax County Health Department records an inspection outcome, such as Passed or Partial Pass, with each of its reports. Where CleanPlateVA displays that outcome, it is the county’s determination. It is neither derived from nor used to derive CleanPlateVA’s score or grade, and the two may differ.</p>
            <p>CleanPlateVA provides these calculations as a tool for comparing and reviewing inspection histories. They are provided as is, without warranty as to accuracy, completeness, or suitability for any particular purpose.</p>
            <h3>Location Data</h3>
            <p>Restaurant locations and map coordinates are compiled from public and open geographic data sources, including:</p>
            <ul>
                <li>Virginia Geographic Information Network (VGIN), Virginia Department of Emergency Management</li>
                <li>U.S. Census Bureau Geocoder and Gazetteer</li>
                <li>OpenStreetMap and Nominatim</li>
                <li>Overture Maps Foundation</li>
                <li>Foursquare OS Places</li>
                <li>Fairfax County GIS establishment locations, published by the Fairfax County Health Department with its inspection records</li>
            </ul>
            <p>Some locations are approximate. Certain locations may also be manually placed or corrected by CleanPlateVA based on available source information.</p>
            <h3>Data and Map Attribution</h3>
            <ul>
                <li><strong>Inspection records:</strong> Virginia Department of Health, via <a href={PORTAL_URL} target="_blank" rel="noopener">MyHealthDepartment</a>.</li>
                <li><strong>Inspection records (Fairfax localities):</strong> Fairfax County Health Department, via its <a href={FAIRFAX_RECORDS_URL} target="_blank" rel="noopener">Food Establishment Inspection Reports</a> system.</li>
                <li><strong>Establishment locations (Fairfax County):</strong> Fairfax County GIS, published by the Fairfax County Health Department.</li>
                <li><strong>Address data:</strong> <a href="https://vgin.vdem.virginia.gov/" target="_blank" rel="noopener">Virginia Geographic Information Network (VGIN)</a>, Virginia Department of Emergency Management.</li>
                <li><strong>Geocoding:</strong> <a href="https://geocoding.geo.census.gov/" target="_blank" rel="noopener">U.S. Census Bureau Geocoder and Gazetteer</a>.</li>
                <li><strong>Map data and geocoding:</strong> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors. OpenStreetMap data is made available under the <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">Open Database License (ODbL)</a>.</li>
                <li><strong>Places data:</strong> <a href="https://overturemaps.org" target="_blank" rel="noopener">Overture Maps Foundation</a>, including data made available under <a href="https://cdla.dev/permissive-2-0/" target="_blank" rel="noopener">CDLA-Permissive 2.0</a> and other applicable open licenses.</li>
                <li><strong>Places data:</strong> <a href="https://opensource.foursquare.com/os-places/" target="_blank" rel="noopener">Foursquare OS Places</a>, © 2026 Foursquare Labs, Inc. All rights reserved, made available under the <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache License 2.0</a>. See the Foursquare notice below.</li>
                <li><strong>Basemap:</strong> © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> and © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.</li>
                <li><strong>Aerial imagery:</strong> <a href="https://vgin.vdem.virginia.gov/pages/orthoimagery" target="_blank" rel="noopener">Virginia Base Mapping Program (VBMP)</a> orthoimagery, © <a href="https://vgin.vdem.virginia.gov/" target="_blank" rel="noopener">Virginia Geographic Information Network (VGIN)</a>, Virginia Department of Emergency Management. Imagery is displayed only when the aerial basemap is selected.</li>
            </ul>
            <h3>Foursquare Notice</h3>
            <p>© 2026 Foursquare Labs, Inc. All rights reserved.</p>
            <p>The Foursquare OS Places dataset (the “Data”) is licensed under the <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache License, Version 2.0</a> (the “License”). The Data distributed under the License is distributed on an “AS IS” BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License. The complete notice is published by Foursquare at <a href="https://opensource.foursquare.com/places-notice-txt/" target="_blank" rel="noopener">opensource.foursquare.com</a>.</p>
            <p>CleanPlateVA does not redistribute the Data. Coordinates from selected Foursquare OS Places records are used to position markers for the corresponding establishments, and those coordinates appear in data published by CleanPlateVA. No other field of the Data is published, and the Data itself is not modified.</p>
            <p>CleanPlateVA’s independently calculated scores, grades, classifications, and presentation may be cited with credit to CleanPlateVA. No additional license to CleanPlateVA-created material is granted by these terms.</p>
            <h3>Acknowledgment</h3>
            <p>By selecting “Agree and View Grades”, you acknowledge that you have read and understood these terms and that CleanPlateVA’s scores and grades are independent calculations rather than official ratings issued by any health department.</p>
            <p>If you do not agree, you may continue using the basic map without CleanPlateVA inspection grades.</p>
            <p>Your selection will be remembered on this device and can be changed later from the About page.</p>
        </div>
    )
}
